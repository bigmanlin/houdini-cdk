import { Stack, StackProps, RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
  Distribution,
  ViewerProtocolPolicy,
  PriceClass,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, ARecord, AaaaRecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { join } from 'path';

const ZONE_NAME = 'tradehoudini.com';

/// The public marketing/legal site. Separate from the API: it serves static files
/// with no origin to keep warm, and App Store review needs the privacy policy
/// readable without a token.
export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const hostedZone = HostedZone.fromLookup(this, 'HoudiniZone', {
      domainName: ZONE_NAME,
    });

    // Private origin: CloudFront reaches it through Origin Access Control, so the
    // bucket itself is never public.
    const bucket = new Bucket(this, 'SiteBucket', {
      bucketName: `houdini-site-${this.account}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // CloudFront only accepts certificates from us-east-1, whatever region the
    // distribution serves from.
    const certificate = new Certificate(this, 'SiteCertificate', {
      domainName: ZONE_NAME,
      subjectAlternativeNames: [`www.${ZONE_NAME}`],
      validation: CertificateValidation.fromDns(hostedZone),
    });

    const distribution = new Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: [ZONE_NAME, `www.${ZONE_NAME}`],
      certificate,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
    });

    new BucketDeployment(this, 'SiteContent', {
      sources: [Source.asset(join(__dirname, 'content'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    for (const name of [ZONE_NAME, `www.${ZONE_NAME}`]) {
      const suffix = name.startsWith('www') ? 'Www' : 'Apex';
      new ARecord(this, `SiteAlias${suffix}`, {
        zone: hostedZone,
        recordName: name,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      });
      new AaaaRecord(this, `SiteAliasAaaa${suffix}`, {
        zone: hostedZone,
        recordName: name,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
      });
    }
  }
}
