import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';

export class EcrStack extends Stack {
  public readonly repository: Repository;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.repository = new Repository(this, 'HoudiniRepository', {
      repositoryName: 'houdini',
      imageTagMutability: TagMutability.MUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
