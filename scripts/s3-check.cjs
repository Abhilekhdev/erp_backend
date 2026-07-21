/**
 * S3 connectivity self-test — run AFTER filling the AWS_* keys in .env:
 *
 *   node scripts/s3-check.cjs
 *
 * Proves, in order: credentials work → the bucket is writable → the object is readable through a
 * presigned URL → cleanup. If any step fails it prints the AWS error verbatim plus the usual cause,
 * so you can fix the IAM policy / bucket name without guessing.
 */
require('dotenv').config();
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const {
  AWS_BUCKET,
  AWS_DEFAULT_REGION = 'ap-south-1',
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_ENDPOINT,
  AWS_USE_PATH_STYLE_ENDPOINT,
} = process.env;

const HINTS = {
  NoSuchBucket: 'The bucket name is wrong, or it lives in a different region than AWS_DEFAULT_REGION.',
  InvalidAccessKeyId: 'AWS_ACCESS_KEY_ID is wrong (or the key was deleted).',
  SignatureDoesNotMatch: 'AWS_SECRET_ACCESS_KEY is wrong — copy it again, no stray spaces/quotes.',
  AccessDenied: 'Credentials are valid but the IAM policy lacks s3:PutObject/GetObject/DeleteObject on this bucket.',
  PermanentRedirect: 'Right bucket, wrong region — set AWS_DEFAULT_REGION to the bucket\'s region.',
  ExpiredToken: 'These are temporary credentials and they have expired.',
};

function fail(step, err) {
  const code = err?.name || err?.Code || 'Unknown';
  const status = err?.$metadata?.httpStatusCode;
  console.error(`\n❌ ${step} failed: ${code}${status ? ` (HTTP ${status})` : ''}`);
  console.error(`   ${err?.message ?? err}`);

  // HeadBucket is a HEAD request, so S3 replies with NO body — the SDK cannot read an error code
  // and surfaces a bare "UnknownError". Status 403 there means the credentials are valid but the
  // IAM policy grants nothing; 301/307 means the bucket lives in another region.
  if (status === 403) {
    console.error('   → Credentials are VALID but this IAM user has no permission for that action.');
    console.error('     Attach the bucket policy to the user (IAM → Users → Permissions → Add permissions).');
  } else if (status === 301 || status === 307) {
    console.error("   → Wrong region. Set AWS_DEFAULT_REGION to the bucket's region.");
  } else if (HINTS[code]) {
    console.error(`   → ${HINTS[code]}`);
  }
  process.exit(1);
}

(async () => {
  if (!AWS_BUCKET) {
    console.error('❌ AWS_BUCKET is empty in .env — the app is in LOCAL DISK mode, nothing to check.');
    process.exit(1);
  }
  console.log(`bucket : ${AWS_BUCKET}`);
  console.log(`region : ${AWS_DEFAULT_REGION}`);
  console.log(`key id : ${AWS_ACCESS_KEY_ID ? AWS_ACCESS_KEY_ID.slice(0, 6) + '…' : '(none — using default cred chain)'}`);
  if (AWS_ENDPOINT) console.log(`endpoint: ${AWS_ENDPOINT}`);

  const s3 = new S3Client({
    region: AWS_DEFAULT_REGION,
    ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } }
      : {}),
    ...(AWS_ENDPOINT ? { endpoint: AWS_ENDPOINT } : {}),
    forcePathStyle: AWS_USE_PATH_STYLE_ENDPOINT === 'true',
  });

  const key = `_healthcheck/erp-${Date.now()}.txt`;
  const body = 'erp-panel s3 check';

  try {
    await s3.send(new HeadBucketCommand({ Bucket: AWS_BUCKET }));
    console.log('\n✔ 1/4 bucket reachable');
  } catch (e) {
    fail('1/4 bucket reachable', e);
  }

  try {
    await s3.send(new PutObjectCommand({ Bucket: AWS_BUCKET, Key: key, Body: body, ContentType: 'text/plain' }));
    console.log('✔ 2/4 upload (s3:PutObject)');
  } catch (e) {
    fail('2/4 upload', e);
  }

  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: AWS_BUCKET, Key: key }), { expiresIn: 300 });
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok || text !== body) throw new Error(`presigned GET returned HTTP ${res.status}: ${text.slice(0, 120)}`);
    console.log('✔ 3/4 presigned download (s3:GetObject)');
  } catch (e) {
    fail('3/4 presigned download', e);
  }

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: AWS_BUCKET, Key: key }));
    console.log('✔ 4/4 delete (s3:DeleteObject)');
  } catch (e) {
    fail('4/4 delete', e);
  }

  console.log('\n🎉 S3 is configured correctly — uploads will go to the bucket.');
})();
