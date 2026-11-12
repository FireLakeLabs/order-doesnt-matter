# Hosting runbook

`OrderDoesntMatter` owns two private retained S3 buckets (website and releases),
one CloudFront distribution/OAC, response headers, A/AAAA records for
`odm.firelakelabs.com`, and two repository/environment-specific GitHub roles.
It shares only the certificate, hosted zone, GitHub OIDC provider and existing
CDK bootstrap roles by reference. No context lookups. Do not rebootstrap or
modify other sites.

## First provisioning (owner present)

Use Node from `.node-version`. `mms-deploy` is a historical profile name.
Obtain a fresh short-lived session, then from the repository root:

```bash
aws login --profile mms-deploy
export AWS_PROFILE=mms-deploy
cd infra
npm ci
npm test
node scripts/check-cdk-access.mts
npx cdk synth OrderDoesntMatter --strict --quiet
npx cdk diff OrderDoesntMatter --no-change-set
# Review the diff and resource list before continuing.
npx cdk deploy OrderDoesntMatter --require-approval broadening --outputs-file outputs.json
cat outputs.json
```

Before deployment, confirm the referenced certificate covers the hostname and
zone ownership is correct. Compare `config.mts` against:

```bash
gh api repos/FireLakeLabs/order-doesnt-matter/actions/oidc/customization/sub
```

Retain the immutable subject; do not broaden trust. The access check assumes
only the three existing bootstrap roles, discards credentials, and prints ARNs.
Bootstrap infrastructure access is privileged; it can pass the shared execution
role. Only trusted administrators should approve infrastructure changes on main.

In GitHub Settings → Environments, create `production` and `infrastructure`.
For both, select deployment branches/tags: **Branch → main only**, no tags.
Only after both environments exist and are restricted to `main`, set the
repository variable `ODM_DEPLOY_ENABLED` to `true`; until then Deploy never
enters an environment.

Set environment variable `AWS_ROLE_ARN` from `AppDeployRoleArn` (production) or
`InfraDeployRoleArn` (infrastructure). In production also set `HOSTING_OUTPUTS`
to the entire `outputs.json` document. These values are configuration, not secrets.
Refresh outputs after infrastructure changes. The app role has no CloudFormation
permissions: the publisher checks supplied stack identity, deterministic bucket
names, account, distribution ARN, alias, certificate, origin/OAC and redirects.

First publish: run **Deploy → Run workflow → main** with rollback blank.
The gate retains one publish artifact; publishing never rebuilds it. The required
browser command separately builds its own temporary test copy. With no production
role variable, configuration succeeds and the deploy job is skipped.

## Hosted verification and recovery

Owner checklist: valid HTTPS; HTTP redirects; anonymous S3 GET fails for both
buckets; homepage bytes match the retained artifact; missing assets remain errors;
JavaScript MIME/cache headers are correct; press Play in a fresh tab and check
worker/worklet requests and sample loading. Listening requires a person; automated
checks cannot establish what was heard. Check an older tab after a new publish.

Rollback: run Deploy on main with `rollback_release` set to an exact completed
archive ID (`release.json` exists). Checksums precede website writes; assets precede
HTML. No deletes or automatic expiration. Retain archives/assets indefinitely;
cleanup requires separate review. Coordinate local recovery with all publishers:
`HOSTING_OUTPUTS="$(cat infra/outputs.json)" node infra/scripts/hosting.mts rollback RELEASE_ID`
from the root with the fresh profile.

Pinned MMS tooling carries the upstream-blocked minimatch moderate advisory
[disposition](https://github.com/FireLakeLabs/monkeyboys-modular-synth/blob/main/docs/cdk-advisory.md).
No untrusted glob inputs or browser CDK dependencies are introduced. Reassess the
advisory when upgrading; no forced override is applied.
