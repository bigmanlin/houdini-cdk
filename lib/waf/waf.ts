import { Stack, StackProps } from 'aws-cdk-lib';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

interface WafStackProps extends StackProps {
  // The public ALB this Web ACL guards. WAF associates to the load balancer, so
  // it sees client requests before they reach the Fargate tasks — the only
  // layer that can shed a volumetric flood before it burns CPU shared by the
  // HTTP server and the in-process trade consumer.
  loadBalancerArn: string;
}

// Positional string match on the request path, always lowercased so `/Internal`
// cannot slip a rule. Used bare (block) and as a rate-rule scope-down.
function uriPathMatch(
  constraint: 'STARTS_WITH' | 'ENDS_WITH',
  value: string,
): CfnWebACL.StatementProperty {
  return {
    byteMatchStatement: {
      fieldToMatch: { uriPath: {} },
      positionalConstraint: constraint,
      searchString: value,
      textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
    },
  };
}

const visibility = (metricName: string): CfnWebACL.VisibilityConfigProperty => ({
  sampledRequestsEnabled: true,
  cloudWatchMetricsEnabled: true,
  metricName,
});

// WAF is the per-IP, volumetric layer only. Per-user / per-account fairness
// lives in the application (it needs the Auth0 `sub`, which WAF cannot read) —
// this ACL is the coarse outer wall, not that fairness layer.
//
// Rollout: `block-internal` and the generous blanket cap block immediately —
// neither can plausibly hit legitimate traffic. The two tight caps on the
// billed routes start in COUNT so a shared carrier-NAT IP (many mobile users
// behind one address) can't be blocked before the CloudWatch metrics prove the
// limit is clear. Flip their actions to `block` once observed.
const COUNT: CfnWebACL.RuleActionProperty = { count: {} };
const BLOCK: CfnWebACL.RuleActionProperty = { block: {} };

export class WafStack extends Stack {
  constructor(scope: Construct, id: string, props: WafStackProps) {
    super(scope, id, props);

    const rules: CfnWebACL.RuleProperty[] = [
      // The `/internal/*` routes carry no auth and only ever had system callers;
      // the trigger Lambdas are disabled and RunTask never uses HTTP, so nothing
      // legitimate reaches them over the internet. Blocked outright, first, so it
      // short-circuits before any request is counted. Coupling: re-enabling those
      // Lambdas as an HTTP fallback means removing this rule.
      {
        name: 'block-internal',
        priority: 0,
        action: BLOCK,
        statement: uriPathMatch('STARTS_WITH', '/internal'),
        visibilityConfig: visibility('blockInternal'),
      },

      // launch is the heaviest single call: a Claude universe scout plus a new
      // portfolio and a new EventBridge schedule. Nobody launches in bulk, so a
      // low cap catches both spend abuse and resource-creation spam.
      {
        name: 'rate-launch',
        priority: 1,
        action: COUNT,
        statement: {
          rateBasedStatement: {
            limit: 20,
            aggregateKeyType: 'IP',
            evaluationWindowSec: 60,
            scopeDownStatement: uriPathMatch('ENDS_WITH', '/launch'),
          },
        },
        visibilityConfig: visibility('rateLaunch'),
      },

      // The other Anthropic-billed routes: chat streams, and buy/sell each fire a
      // briefing. Counts an unauthenticated flood here too, before it reaches the
      // tasks and pays for JWT verification.
      {
        name: 'rate-billed-routes',
        priority: 2,
        action: COUNT,
        statement: {
          rateBasedStatement: {
            limit: 100,
            aggregateKeyType: 'IP',
            evaluationWindowSec: 60,
            scopeDownStatement: {
              orStatement: {
                statements: [
                  uriPathMatch('ENDS_WITH', '/agents/chat'),
                  uriPathMatch('ENDS_WITH', '/buy'),
                  uriPathMatch('ENDS_WITH', '/sell'),
                ],
              },
            },
          },
        },
        visibilityConfig: visibility('rateBilledRoutes'),
      },

      // Catch-all volumetric cap (~6.7 req/s sustained per IP). Deliberately
      // generous: a cold app launch bursts dozens of requests, and carrier NAT
      // stacks several users on one IP. A real flood is orders of magnitude past
      // this and gets cut.
      {
        name: 'rate-blanket',
        priority: 3,
        action: BLOCK,
        statement: {
          rateBasedStatement: {
            limit: 2000,
            aggregateKeyType: 'IP',
            evaluationWindowSec: 300,
          },
        },
        visibilityConfig: visibility('rateBlanket'),
      },
    ];

    const webAcl = new CfnWebACL(this, 'HoudiniAlbAcl', {
      name: 'houdini-alb-acl',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibility('houdiniAlbAcl'),
      rules,
    });

    new CfnWebACLAssociation(this, 'HoudiniAlbAclAssociation', {
      resourceArn: props.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });
  }
}
