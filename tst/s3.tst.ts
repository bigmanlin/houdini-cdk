import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { S3Stack } from '../lib/s3/s3';

describe('S3Stack', () => {
  const app = new App();
  const stack = new S3Stack(app, 'TestS3Stack');
  const template = Template.fromStack(stack);

  test('creates the strategies and uploads buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  test('strategies bucket has versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  test('uploads bucket expires temp objects via a lifecycle rule', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: [{ Prefix: 'tmp/', Status: 'Enabled', ExpirationInDays: 2 }],
      },
    });
  });

  test('bucket has S3 managed encryption', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' },
          },
        ],
      },
    });
  });
});
