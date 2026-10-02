import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
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

  test('strategies bucket expires the reads store after ninety days', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          {
            Prefix: 'reads/',
            Status: 'Enabled',
            ExpirationInDays: 90,
            NoncurrentVersionExpiration: { NoncurrentDays: 1 },
          },
        ]),
      },
    });
  });

  // A delete or a move can be undone for a month; after that an erased
  // owner's files are gone for good.
  test('strategies bucket keeps old versions of everything else for a month', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: 'Enabled',
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            ExpiredObjectDeleteMarker: true,
          }),
        ]),
      },
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
