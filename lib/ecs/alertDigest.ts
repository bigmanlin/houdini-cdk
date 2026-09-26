import { Duration } from 'aws-cdk-lib';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

interface AlertDigestProps {
  alarms: Topic;
  logGroup: LogGroup;
}

// CloudWatch's own mail names the alarm and nothing else; the error lines that
// explain it are a login and three taps away on a phone. This reads the last
// half hour of error lines when an alarm fires and mails them with it, so the
// first mail is the whole picture. Recoveries send nothing.
export class AlertDigest extends Construct {
  public readonly alerts: Topic;

  constructor(scope: Construct, id: string, props: AlertDigestProps) {
    super(scope, id);

    // Subscriptions are added by hand, as on the alarms topic, so an address
    // is not written into the repository.
    this.alerts = new Topic(this, 'AtriusAlerts', {
      topicName: 'atrius-alerts',
      displayName: 'Atrius alerts',
    });

    const executionRole = new Role(this, 'DigestExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
    props.logGroup.grant(executionRole, 'logs:FilterLogEvents');
    this.alerts.grantPublish(executionRole);

    const digest = new Function(this, 'DigestFunction', {
      functionName: 'atrius-alert-digest',
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(60),
      memorySize: 256,
      role: executionRole,
      environment: {
        LOG_GROUP: props.logGroup.logGroupName,
        ALERTS_TOPIC_ARN: this.alerts.topicArn,
      },
      code: Code.fromInline(`
const { CloudWatchLogsClient, FilterLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const logs = new CloudWatchLogsClient();
const sns = new SNSClient();
const group = process.env.LOG_GROUP;
const region = process.env.AWS_REGION;
const link = 'https://' + region + '.console.aws.amazon.com/cloudwatch/home?region=' + region +
  '#logsV2:log-groups/log-group/' + encodeURIComponent(encodeURIComponent(group)).replace(/%/g, '$');
const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

const recentErrors = async () => {
  const now = Date.now();
  const events = [];
  let nextToken;
  for (let page = 0; page < 5; page++) {
    const out = await logs.send(new FilterLogEventsCommand({
      logGroupName: group, startTime: now - 30 * 60 * 1000, endTime: now,
      filterPattern: '{ $.level = "error" }', nextToken,
    }));
    events.push(...(out.events || []));
    nextToken = out.nextToken;
    if (!nextToken) break;
  }
  const groups = new Map();
  for (const event of events) {
    let line;
    try { line = JSON.parse(event.message); } catch { line = { message: event.message }; }
    const where = [line.provider, line.call, line.tool, line.route].filter(Boolean).join('/');
    const error = line.error === undefined ? '' : text(line.error).slice(0, 160);
    const key = [line.message, where, error].join('|');
    const seen = groups.get(key) || { count: 0, newest: 0, message: line.message, where };
    seen.count += 1;
    if (event.timestamp >= seen.newest) {
      seen.newest = event.timestamp;
      seen.what = error || (line.issues === undefined ? '' : text(line.issues).slice(0, 160));
    }
    groups.set(key, seen);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.newest - a.newest);
};

const body = (reason, groups) => {
  const lines = groups.slice(0, 12).map((g) =>
    [clock.format(g.newest) + ' ET  \\u00d7' + g.count + '  ' + g.message, g.where, g.what]
      .filter(Boolean).join(' \\u2014 '));
  const middle = lines.length ? lines.join('\\n') : 'No error lines in ' + group + ' in the last 30 minutes.';
  return reason + '\\n\\n' + middle + '\\n\\n' + link;
};

exports.handler = async (event) => {
  for (const record of event.Records) {
    let alarm;
    try { alarm = JSON.parse(record.Sns.Message); } catch { continue; }
    if (alarm.NewStateValue !== 'ALARM') continue;
    let message;
    try {
      message = body(alarm.NewStateReason, await recentErrors());
    } catch (err) {
      message = alarm.NewStateReason + '\\n\\nCould not read ' + group + ': ' + (err.message || err) + '\\n\\n' + link;
    }
    await sns.send(new PublishCommand({
      TopicArn: process.env.ALERTS_TOPIC_ARN,
      Subject: ('Atrius: ' + alarm.AlarmName).slice(0, 100),
      Message: message,
    }));
  }
};
      `),
    });

    props.alarms.addSubscription(new LambdaSubscription(digest));
  }
}
