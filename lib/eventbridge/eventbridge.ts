import { Stack, StackProps } from 'aws-cdk-lib';
import { CfnSchedule, CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

interface EventBridgeStackProps extends StackProps {
  cronJobQueue: Queue;
  eodFunction: NodejsFunction;
}

export class EventBridgeStack extends Stack {
  public readonly scheduleGroup: CfnScheduleGroup;
  public readonly schedulerRole: Role;

  constructor(scope: Construct, id: string, props: EventBridgeStackProps) {
    super(scope, id, props);

    // Schedule group used by ECS to dynamically create per-portfolio cron job schedules
    this.scheduleGroup = new CfnScheduleGroup(this, 'CronJobScheduleGroup', {
      name: 'houdini-cron-jobs',
    });

    // IAM role that allows EventBridge Scheduler to send messages to the cron job SQS queue
    this.schedulerRole = new Role(this, 'SchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to send messages to the cron job SQS queue',
    });

    this.schedulerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [props.cronJobQueue.queueArn],
      }),
    );

    // IAM role that allows EventBridge Scheduler to invoke the EOD Lambda
    const eodSchedulerRole = new Role(this, 'EodSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the EOD Lambda',
    });

    eodSchedulerRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [props.eodFunction.functionArn],
      }),
    );

    // Fires at 4:30 PM ET (20:30 UTC) on weekdays — 30 minutes after market close
    new CfnSchedule(this, 'EodSchedule', {
      name: 'houdini-eod',
      groupName: this.scheduleGroup.name,
      scheduleExpression: 'cron(30 20 ? * MON-FRI *)',
      scheduleExpressionTimezone: 'America/New_York',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: props.eodFunction.functionArn,
        roleArn: eodSchedulerRole.roleArn,
      },
    });
  }
}
