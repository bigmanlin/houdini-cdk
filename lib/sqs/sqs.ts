import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class SqsStack extends Stack {
  // The API's nudge to the worker: "look at this agent now". The agent row is
  // the queue of record and the worker's clock drains it regardless, so a
  // message here is spent on receipt and needs no dead letter queue.
  public readonly workerQueue: Queue;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.workerQueue = new Queue(this, 'WorkerQueue', {
      queueName: 'atrius-worker-queue',
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      receiveMessageWaitTime: Duration.seconds(20),
    });
  }
}
