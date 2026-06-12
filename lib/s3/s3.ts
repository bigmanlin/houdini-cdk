import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class S3Stack extends Stack {
  public readonly strategiesBucket: Bucket;
  public readonly uploadsBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.strategiesBucket = new Bucket(this, 'StrategiesBucket', {
      bucketName: `houdini-strategies-${this.account}-${this.region}`,
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Temp bucket for chat attachments. Objects under `tmp/` are ephemeral, so a
    // lifecycle rule expires them a couple of days after upload.
    this.uploadsBucket = new Bucket(this, 'UploadsBucket', {
      bucketName: `houdini-uploads-${this.account}-${this.region}`,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ prefix: 'tmp/', expiration: Duration.days(2) }],
    });
  }
}
