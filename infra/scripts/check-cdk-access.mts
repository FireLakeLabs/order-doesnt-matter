import { aws } from './hosting.mts';
import { bootstrapRoles, hosting } from '../config.mts';

const identity = aws(['sts', 'get-caller-identity']) as { Account?: string };
if (identity.Account !== hosting.account) throw new Error('Unexpected AWS account');

// Discard returned credentials: output only the role ARN, never the session keys.
for (const arn of bootstrapRoles) {
  aws([
    'sts',
    'assume-role',
    '--role-arn',
    arn,
    '--role-session-name',
    'odm-bootstrap-preflight',
    '--query',
    'AssumedRoleUser.Arn',
  ]);
  process.stdout.write(`Verified assumption of ${arn}\n`);
}
