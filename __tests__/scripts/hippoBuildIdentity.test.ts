import fs from 'fs';
import path from 'path';

const repo = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repo, relativePath), 'utf8');

describe('Hippo build identity guard', () => {
  test('the retired Rabby autobuild publisher is absent', () => {
    expect(fs.existsSync(path.join(repo, '.github/workflows/autobuild.yml'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(repo, 'scripts/autobuild.sh'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'scripts/notify-lark.js'))).toBe(false);
  });

  test('the retained local debug packer emits a Hippo artifact name', () => {
    const packer = read('scripts/pack-debug.sh');
    expect(packer).toContain('Hippo_v${app_ver}_debug.');
    expect(packer).not.toContain('Rabby_v${app_ver}_debug.');
  });

  test('no active autobuild identity or publisher controls remain', () => {
    const workflowText = fs
      .readdirSync(path.join(repo, '.github/workflows'))
      .filter((name) => name !== 'flowcheck.yml')
      .map((name) => read(`.github/workflows/${name}`))
      .join('\n');
    const releaseScriptText = fs
      .readdirSync(path.join(repo, 'scripts'))
      .filter((name) => /build|pack|release|publish/i.test(name))
      .map((name) => read(`scripts/${name}`))
      .join('\n');
    for (const forbidden of [
      'RABBY_BUILD_BUCKET',
      'RABBY_SENTRY_DSN',
      'download.rabby.io/autobuild',
      'RabbyDebug-',
      'New Rabby Debug Package',
    ]) {
      expect(`${workflowText}\n${releaseScriptText}`).not.toContain(forbidden);
    }
  });
});
