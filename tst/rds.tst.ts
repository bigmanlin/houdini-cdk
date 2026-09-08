import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { RdsStack } from '../lib/rds/rds';

describe('RdsStack', () => {
  const app = new App();
  const stack = new RdsStack(app, 'TestRdsStack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  // This holds the record of real money. Two separate locks, because a stack
  // teardown and an API call are different mistakes.
  it('cannot be deleted by tearing the stack down or by asking', () => {
    template.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({ DeletionProtection: true }),
    });
  });

  it('is encrypted and reachable only from inside the network', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      StorageEncrypted: true,
      PubliclyAccessible: false,
    });
  });

  // Point-in-time recovery inside this window is what makes a bad migration
  // survivable rather than final.
  it('keeps a week of backups and does not discard them with the instance', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      BackupRetentionPeriod: 7,
      DeleteAutomatedBackups: false,
    });
  });

  // The password is generated into a secret and never appears in a template,
  // an environment variable, or this repository.
  it('generates its own password rather than carrying one', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        GenerateStringKey: 'password',
        ExcludeCharacters: '/@" ',
      }),
    });
  });

  // Access for a person is granted by identity rather than by address: whoever
  // may start a session through the bastion may reach the database, which makes
  // adding somebody a policy change rather than a deploy.
  it('is reachable by a person only through the bastion', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      FromPort: 5432,
      ToPort: 5432,
      Description: 'Database access through Session Manager',
    });
  });

  // No key pair and no inbound rule at all. The agent reaches Session Manager
  // outward, so there is nothing to leave open and no key to leak.
  it('has a bastion nothing can connect to directly', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'Atrius database access. No inbound rules, by design.',
      SecurityGroupIngress: Match.absent(),
    });
    template.hasResourceProperties('AWS::EC2::Instance', {
      KeyName: Match.absent(),
    });
  });
});
