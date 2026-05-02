import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { S3Stack } from '../lib/s3/s3';

describe('S3Stack', () => {
  const app = new App();
  const stack = new S3Stack(app, 'TestS3Stack');
  const template = Template.fromStack(stack);

  test('creates 1 bucket', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });

  test('bucket has versioning enabled', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
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
