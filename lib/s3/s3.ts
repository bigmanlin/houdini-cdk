import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class S3Stack extends Stack {
  public readonly strategiesBucket: Bucket;
  public readonly uploadsBucket: Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The reads store under `reads/` holds the tables a run read, once per
    // distinct table by fingerprint; the run row that names them is in
    // Postgres and outlives them. Ninety days covers every replay anyone asks
    // for. Versioned buckets expire the current version and keep it as a
    // noncurrent one, so the rule expires those too.
    this.strategiesBucket = new Bucket(this, 'StrategiesBucket', {
      bucketName: `houdini-strategies-${this.account}-${this.region}`,
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          prefix: 'reads/',
          expiration: Duration.days(90),
          noncurrentVersionExpiration: Duration.days(1),
        },
      ],
    });

    // Temp bucket for chat attachments. Objects under `tmp/` are ephemeral, so a
    // lifecycle rule expires them a couple of days after upload.
    this.uploadsBucket = new Bucket(this, 'UploadsBucket', {
      bucketName: `houdini-uploads-${this.account}-${this.region}`,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ prefix: 'tmp/', expiration: Duration.days(2) }],
    });
  }
}
