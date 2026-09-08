import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import {
  AmazonLinuxCpuType,
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const DATABASE_NAME = 'atrius';

export class RdsStack extends Stack {
  public readonly instance: DatabaseInstance;
  public readonly credentials: Secret;
  public readonly securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Reachable only from inside the VPC, and then only from whatever is given
    // an ingress rule below. The tasks run in public subnets, so this is what
    // stands between the database and the internet.
    this.securityGroup = new SecurityGroup(this, 'AtriusDatabaseSecurityGroup', {
      vpc,
      description: 'Atrius Postgres. Ingress granted per client security group.',
      allowAllOutbound: false,
    });

    // Generated here and never written down anywhere else. Rotating it is a
    // change to this secret plus a service restart, not an edit to any code.
    this.credentials = new Secret(this, 'AtriusDatabaseCredentials', {
      secretName: 'atrius/database',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'atrius' }),
        generateStringKey: 'password',
        // The connection string is assembled from this, and these three would
        // need escaping in a URL.
        excludeCharacters: '/@" ',
        passwordLength: 40,
      },
    });

    this.instance = new DatabaseInstance(this, 'AtriusDatabase', {
      instanceIdentifier: 'atrius-postgres',
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_17,
      }),
      // Every table we have fits in memory several times over at the size we
      // are. The class is a one-line change and a restart when it does not.
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroups: [this.securityGroup],
      // In the VPC and behind the security group. Nothing on the internet can
      // open a connection to it.
      publiclyAccessible: false,
      credentials: Credentials.fromSecret(this.credentials),
      databaseName: DATABASE_NAME,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: StorageType.GP3,
      storageEncrypted: true,
      backupRetention: Duration.days(7),
      // Point-in-time recovery within that window, which is what makes a bad
      // migration survivable rather than final.
      deleteAutomatedBackups: false,
      // Single instance. A failover pair doubles the cost and the thing it
      // protects against is an outage, not a mistake; backups cover mistakes.
      multiAz: false,
      autoMinorVersionUpgrade: true,
      // Two locks, because this holds the record of real money: the API refuses
      // a delete, and CDK leaves the instance behind if the stack is ever torn
      // down. Removing the database has to be a deliberate act at the console.
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.bastion(vpc);
  }

  /// How a person reads the database with a client, without the database being
  /// reachable from the internet.
  ///
  /// The alternative is an allow list of home addresses, which does not survive
  /// contact with a second person: every new one is a deploy, every one that
  /// moves house is a deploy, and what is open drifts from what anyone believes
  /// is open. This grants by identity instead. Whoever may start a session may
  /// reach the database, and that is a policy rather than a redeploy.
  ///
  /// It has no key pair and no inbound rule at all. Session Manager reaches it
  /// outward through the agent, so there is nothing to leave open by mistake and
  /// nothing to leak. Every session is a CloudTrail entry naming who opened it.
  ///
  /// To use it, forward a local port through it and point the client at
  /// localhost:
  ///
  ///   aws ssm start-session --target <instance id> \
  ///     --document-name AWS-StartPortForwardingSessionToRemoteHost \
  ///     --parameters '{"host":["<endpoint>"],"portNumber":["5432"],"localPortNumber":["5432"]}'
  private bastion(vpc: ReturnType<typeof Vpc.fromLookup>): void {
    const group = new SecurityGroup(this, 'AtriusBastionSecurityGroup', {
      vpc,
      description: 'Atrius database access. No inbound rules, by design.',
      allowAllOutbound: true,
    });

    const host = new Instance(this, 'AtriusBastion', {
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      // The smallest thing that runs the agent. It holds nothing and does
      // nothing; replacing it costs a deploy and loses no state.
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.NANO),
      machineImage: new AmazonLinuxImage({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: group,
      role: new Role(this, 'AtriusBastionRole', {
        assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        ],
      }),
    });

    this.securityGroup.addIngressRule(
      group,
      Port.tcp(5432),
      'Database access through Session Manager',
    );

    new CfnOutput(this, 'BastionInstanceId', {
      value: host.instanceId,
      description: 'Target for aws ssm start-session',
    });
    new CfnOutput(this, 'DatabaseEndpoint', {
      value: this.instance.dbInstanceEndpointAddress,
      description: 'Host to forward to through the bastion',
    });
  }

  /// Ingress is added by the stack that owns the client, not here. A rule
  /// written from this side would need that stack's security group, while that
  /// stack already needs this one's endpoint, and the two references would
  /// close a cycle CDK refuses to deploy.
}
