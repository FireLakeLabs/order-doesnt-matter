import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { bootstrapRoles, hosting } from '../config.mts';
import { createHostingStack } from '../stack.mts';

test('offline synthesis owns only ODM resources and narrowly scoped permissions', () => {
  const outdir = mkdtempSync(join(tmpdir(), 'odm-synth-'));
  try {
    const app = new App({ outdir });
    const stack = createHostingStack(app);
    const template = Template.fromStack(stack);
    const assembly = app.synth();
    assert.equal(assembly.getStackArtifact(hosting.stackName).terminationProtection, true);
    assert.deepEqual(assembly.manifest.missing ?? [], []);
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.allResources('AWS::S3::Bucket', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: Match.objectLike({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
        OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      }),
    });
    const buckets = Object.keys(template.findResources('AWS::S3::Bucket'));
    const policies = Object.values(template.findResources('AWS::S3::BucketPolicy')) as any[];
    assert.equal(policies.length, 2);
    for (const policy of policies) {
      assert(
        policy.Properties.PolicyDocument.Statement.some(
          (s: any) =>
            s.Effect === 'Deny' &&
            s.Action === 's3:*' &&
            s.Condition.Bool['aws:SecureTransport'] === 'false',
        ),
      );
    }
    const websitePolicy = policies.find((p) => p.Properties.Bucket.Ref.startsWith('Website'));
    const grants = websitePolicy.Properties.PolicyDocument.Statement.filter(
      (s: any) => s.Effect === 'Allow',
    );
    assert.equal(grants.length, 1);
    assert.equal(grants[0].Principal.Service, 'cloudfront.amazonaws.com');
    assert.equal(grants[0].Action, 's3:GetObject');
    assert(
      JSON.stringify(grants[0].Condition.StringEquals['AWS:SourceArn']).includes(
        Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0],
      ),
    );
    assert(!JSON.stringify(grants).includes('Releases'));
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    const distribution = Object.values(
      template.findResources('AWS::CloudFront::Distribution'),
    )[0] as any;
    const config = distribution.Properties.DistributionConfig;
    assert.deepEqual(config.Aliases, [hosting.hostname]);
    assert.equal(config.DefaultRootObject, 'index.html');
    assert.equal(config.ViewerCertificate.AcmCertificateArn, hosting.certificateArn);
    assert.equal(config.ViewerCertificate.MinimumProtocolVersion, 'TLSv1.2_2021');
    assert.equal(config.Origins.length, 1);
    assert.deepEqual(config.Origins[0].OriginAccessControlId, {
      'Fn::GetAtt': [
        Object.keys(template.findResources('AWS::CloudFront::OriginAccessControl'))[0],
        'Id',
      ],
    });
    assert(
      JSON.stringify(config.Origins[0].DomainName).includes(
        buckets.find((b) => b.startsWith('Website'))!,
      ),
    );
    assert(!JSON.stringify(config.Origins).includes('Releases'));
    assert(!config.Origins[0].CustomOriginConfig);
    for (const behavior of [config.DefaultCacheBehavior, ...config.CacheBehaviors]) {
      assert.equal(behavior.ViewerProtocolPolicy, 'redirect-to-https');
      assert.equal(behavior.TargetOriginId, config.Origins[0].Id);
      assert(behavior.ResponseHeadersPolicyId.Ref);
    }
    assert.deepEqual(
      config.CustomErrorResponses,
      [403, 404].map((ErrorCode) => ({ ErrorCode, ErrorCachingMinTTL: 0 })),
    );
    assert.deepEqual(
      config.CacheBehaviors.map((b: any) => b.PathPattern),
      ['assets/*'],
    );
    // Managed policies: disabled by default, optimized only for generated assets.
    assert.equal(config.DefaultCacheBehavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    assert.equal(config.CacheBehaviors[0].CachePolicyId, '658327ea-f89d-4fab-a63d-7e88639e58f6');
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: {
          ContentTypeOptions: { Override: true },
          ReferrerPolicy: { ReferrerPolicy: 'strict-origin-when-cross-origin', Override: true },
          StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, Override: true },
        },
      }),
    });
    const records = Object.values(template.findResources('AWS::Route53::RecordSet')) as any[];
    assert.deepEqual(records.map((r) => r.Properties.Type).sort(), ['A', 'AAAA']);
    for (const record of records) {
      assert.equal(record.Properties.Name, `${hosting.hostname}.`);
      assert.equal(record.Properties.HostedZoneId, hosting.zoneId);
      assert(record.Properties.AliasTarget);
    }
    template.resourceCountIs('AWS::IAM::Role', 2);
    const roles = Object.entries(template.findResources('AWS::IAM::Role')) as [string, any][];
    for (const [id, role] of roles) {
      const environment = id.startsWith('AppDeployRole') ? 'production' : 'infrastructure';
      assert.deepEqual(role.Properties.AssumeRolePolicyDocument.Statement, [
        {
          Action: 'sts:AssumeRoleWithWebIdentity',
          Effect: 'Allow',
          Principal: { Federated: hosting.oidcProviderArn },
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              'token.actions.githubusercontent.com:sub': `${hosting.oidcSubjectPrefix}:environment:${environment}`,
            },
          },
        },
      ]);
      assert.equal(role.Properties.ManagedPolicyArns, undefined);
      assert.equal(role.Properties.Policies, undefined);
    }
    template.resourceCountIs('AWS::IAM::Policy', 2);
    const rolePolicies = Object.entries(template.findResources('AWS::IAM::Policy')) as [
      string,
      any,
    ][];
    const appPolicy = rolePolicies.find(([id]) => id.startsWith('AppDeployRole'))![1].Properties
      .PolicyDocument;
    const allowed = new Set([
      's3:ListBucket',
      's3:GetBucketLocation',
      's3:GetObject',
      's3:PutObject',
      'cloudfront:GetDistribution',
      'cloudfront:CreateInvalidation',
      'cloudfront:GetInvalidation',
    ]);
    for (const statement of appPolicy.Statement) {
      assert.equal(statement.Effect, 'Allow');
      for (const action of [statement.Action].flat()) assert(allowed.has(action), action);
      assert(![statement.Resource].flat().includes('*'));
      const resources = JSON.stringify(statement.Resource);
      const service = [statement.Action].flat()[0].split(':')[0];
      if (service === 's3') {
        assert(buckets.some((id) => resources.includes(id)));
        assert(!resources.includes('arn:aws:'));
      } else {
        assert(
          resources.includes(
            Object.keys(template.findResources('AWS::CloudFront::Distribution'))[0],
          ),
        );
      }
    }
    const infraPolicy = rolePolicies.find(([id]) => id.startsWith('InfraDeployRole'))![1].Properties
      .PolicyDocument;
    assert.deepEqual(infraPolicy.Statement, [
      { Action: 'sts:AssumeRole', Effect: 'Allow', Resource: bootstrapRoles },
      {
        Action: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        Effect: 'Allow',
        Resource: `arn:aws:cloudformation:${hosting.region}:${hosting.account}:stack/${hosting.stackName}/*`,
      },
    ]);
    assert(!/Monkeyboys|monkeyboys|FireLakeLabs-dev|mms\./.test(JSON.stringify(template.toJSON())));
    for (const type of [
      'AWS::Route53::HostedZone',
      'AWS::CertificateManager::Certificate',
      'AWS::IAM::OIDCProvider',
      'AWS::CloudFormation::Stack',
    ])
      template.resourceCountIs(type, 0);
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
});
