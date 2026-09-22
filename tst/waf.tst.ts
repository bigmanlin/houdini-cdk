import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { WafStack } from '../lib/waf/waf';

describe('WafStack', () => {
  const app = new App();
  const stack = new WafStack(app, 'TestWafStack', {
    loadBalancerArn:
      'arn:aws:elasticloadbalancing:us-west-2:111111111111:loadbalancer/app/test/abc',
  });
  const template = Template.fromStack(stack);

  const rule = (name: string, rest: object) =>
    Match.objectLike({ Name: name, ...rest });
  const group = (name: string) => ({
    Statement: {
      ManagedRuleGroupStatement: { VendorName: 'AWS', Name: name },
    },
  });

  test('blocks known-bad addresses and exploit payloads', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        rule('aws-ip-reputation', {
          OverrideAction: { None: {} },
          ...group('AWSManagedRulesAmazonIpReputationList'),
        }),
        rule('aws-known-bad-inputs', {
          OverrideAction: { None: {} },
          ...group('AWSManagedRulesKnownBadInputsRuleSet'),
        }),
      ]),
    });
  });

  // Its body rules would refuse a long chat, so it only counts until its
  // metrics say which of its rules the app trips.
  test('only counts the common rule set', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        rule('aws-common', {
          OverrideAction: { Count: {} },
          ...group('AWSManagedRulesCommonRuleSet'),
        }),
      ]),
    });
  });

  test('keeps the per-address caps and the internal block ahead of them', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: Match.arrayWith([
        rule('block-internal', { Priority: 0, Action: { Block: {} } }),
        rule('rate-blanket', { Priority: 3, Action: { Block: {} } }),
      ]),
    });
  });
});
