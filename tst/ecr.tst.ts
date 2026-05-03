import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EcrStack } from '../lib/ecr/ecr';

describe('EcrStack', () => {
  const app = new App();
  const stack = new EcrStack(app, 'TestEcrStack');
  const template = Template.fromStack(stack);

  test('creates 1 repository', () => {
    template.resourceCountIs('AWS::ECR::Repository', 1);
  });

  test('repository is named houdini', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'houdini',
    });
  });

  test('repository has RETAIN deletion policy', () => {
    template.hasResource('AWS::ECR::Repository', {
      DeletionPolicy: 'Retain',
    });
  });
});
