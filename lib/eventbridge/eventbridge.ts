import { Stack, StackProps } from 'aws-cdk-lib';
import { CfnScheduleGroup } from 'aws-cdk-lib/aws-scheduler';
import { Role, ServicePrincipal, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

interface EventBridgeStackProps extends StackProps {
  cronJobQueue: Queue;
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
  }
}
