export const hosting = {
  account: '410633461462',
  region: 'us-east-1',
  stackName: 'OrderDoesntMatter',
  hostname: 'odm.firelakelabs.com',
  zoneName: 'firelakelabs.com',
  websiteBucketName: 'odm-410633461462-us-east-1-website',
  releasesBucketName: 'odm-410633461462-us-east-1-releases',
  oidcProviderArn: 'arn:aws:iam::410633461462:oidc-provider/token.actions.githubusercontent.com',
  zoneId: 'Z06678771L6FN5R60H05L',
  certificateArn:
    'arn:aws:acm:us-east-1:410633461462:certificate/ebdef209-903e-47dc-8d84-dd5328875e05',
  // Exact sub_claim_prefix returned by the repository's GitHub OIDC settings API.
  oidcSubjectPrefix: 'repo:FireLakeLabs@267435624/order-doesnt-matter@1453373446',
} as const;

export const bootstrapRoles = ['deploy', 'file-publishing', 'lookup'].map(
  (purpose) =>
    `arn:aws:iam::${hosting.account}:role/cdk-hnb659fds-${purpose}-role-${hosting.account}-${hosting.region}`,
);
