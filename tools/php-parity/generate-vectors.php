<?php

/**
 * Golden-vector generator for the Account Center crypto port.
 *
 * Runs the customer's VERBATIM AesCbc256 library against fixed inputs and
 * writes the results to a JSON fixture. The TypeScript port in
 * src/lib/account-center/crypto.ts is asserted against this fixture, so any
 * divergence from PHP fails the test suite rather than the production login.
 *
 * Regenerate with:  php tools/php-parity/generate-vectors.php
 */

require __DIR__ . '/AesCbc256.php';

use App\Library\AesCbc256;

$aes = new AesCbc256();

/** The secret is arbitrary; only determinism matters for the fixture. */
$secret = 'account-center-shared-secret-2023';
$key    = md5($secret); // 32 lowercase hex chars, used as 32 RAW ASCII bytes

/**
 * IVs are hard-coded here. Production uses getIV() which is random
 * (substr(md5(uniqid()), 0, 16)); fixed values make the fixture reproducible.
 */
$aesCases = [
    ['label' => 'ascii-short',        'iv' => '0123456789abcdef', 'plain' => 'hello'],
    ['label' => 'password-like',      'iv' => 'fedcba9876543210', 'plain' => 'P@ssw0rd!123'],
    ['label' => 'json-payload',       'iv' => 'a1b2c3d4e5f60718', 'plain' => '{"email":"user@example.com","password":"secret"}'],
    ['label' => 'exact-block-16',     'iv' => '00112233445566aa', 'plain' => str_repeat('A', 16)],
    ['label' => 'two-blocks-32',      'iv' => 'aa66554433221100', 'plain' => str_repeat('B', 32)],
    ['label' => 'empty-string',       'iv' => '1234567890abcdef', 'plain' => ''],
    ['label' => 'utf8-multibyte',     'iv' => 'ffeeddccbbaa9988', 'plain' => 'unicode: äöü 日本語 🎉 emoji'],
    ['label' => 'json-special-chars', 'iv' => '9988776655443322', 'plain' => 'slash/backslash\\quote"newline' . "\n" . 'tab' . "\t" . 'end'],
    ['label' => 'long-512',           'iv' => '2233445566778899', 'plain' => str_repeat('The quick brown fox. ', 25)],
];

$aesVectors = [];
foreach ($aesCases as $c) {
    $ciphertext = $aes->encrypt($c['plain'], $key, $c['iv']);

    // NOTE the asymmetry, faithfully exercised here:
    //   encrypt() takes a RAW iv, decrypt() takes a BASE64 iv.
    $decrypted = $aes->decrypt($ciphertext, $key, base64_encode($c['iv']));

    $aesVectors[] = [
        'label'          => $c['label'],
        'iv'             => $c['iv'],
        'ivBase64'       => base64_encode($c['iv']),
        'plaintext'      => $c['plain'],
        'ciphertext'     => $ciphertext,
        'decrypted'      => $decrypted,
        'roundTripOk'    => $decrypted === $c['plain'],
        // Proves the double-base64: decoding once must still yield base64.
        'innerBase64'    => base64_decode($ciphertext),
    ];
}

/**
 * Replicates AccountCenter::login() body construction (AccountCenter.php:26-40)
 * with a fixed IV so the signature is reproducible.
 */
$clientId = 'monthly-turnover-app';

$loginCases = [
    ['label' => 'simple',        'iv' => '0f1e2d3c4b5a6978', 'email' => 'operator@example.com',      'password' => 'Str0ngP@ss!'],
    ['label' => 'plus-in-email', 'iv' => '78695a4b3c2d1e0f', 'email' => 'ops+jakarta@example.co.id', 'password' => 'a'],
    ['label' => 'long-password', 'iv' => 'abcdef0123456789', 'email' => 'root@example.com',          'password' => str_repeat('x', 64)],
];

$loginPayloads = [];
foreach ($loginCases as $c) {
    $encryptedPassword = $aes->encrypt($c['password'], $key, $c['iv']);

    $body = [
        'email'    => $c['email'],
        'password' => $encryptedPassword,
    ];

    // This is the exact string the signature is computed over.
    $jsonBody  = json_encode($body);
    $signature = $aes->encrypt($jsonBody, $key, $c['iv']);

    $loginPayloads[] = [
        'label'             => $c['label'],
        'iv'                => $c['iv'],
        'email'             => $c['email'],
        'password'          => $c['password'],
        'encryptedPassword' => $encryptedPassword,
        'jsonBody'          => $jsonBody,
        'signature'         => $signature,
        // The whole reason this fixture exists: PHP escapes "/" as "\/",
        // JavaScript's JSON.stringify does not. Base64 contains "/" often.
        'jsonBodyHasEscapedSlash' => str_contains($jsonBody, '\\/'),
        'headers'           => [
            'X-Client-Id' => $clientId,
            'X-Client-Iv' => base64_encode($c['iv']),
            'Signature'   => $signature,
        ],
    ];
}

/**
 * json_encode() parity vectors.
 *
 * The Signature header is AES over the EXACT bytes of json_encode($body).
 * PHP's defaults differ from JavaScript's JSON.stringify in two ways that
 * would silently corrupt the signature:
 *   - PHP escapes "/" as "\/";  JS does not.
 *   - PHP escapes non-ASCII as \uXXXX;  JS emits it literally.
 * Values are strings only: PHP renders float 1.0 as "1.0" while JS renders
 * "1", so numeric payload fields are deliberately out of contract.
 */
$jsonCases = [
    ['label' => 'plain-ascii',      'value' => ['email' => 'a@b.com', 'password' => 'abc']],
    ['label' => 'forward-slash',    'value' => ['url' => 'https://example.com/a/b', 'b64' => 'ab/cd+ef==']],
    ['label' => 'unicode-latin',    'value' => ['name' => 'Müller Ångström']],
    ['label' => 'unicode-cjk',      'value' => ['name' => '日本語のテキスト']],
    ['label' => 'unicode-emoji',    'value' => ['msg' => 'done 🎉 ok']],
    ['label' => 'control-chars',    'value' => ['s' => "line1\nline2\ttab\r\bx\fy"]],
    ['label' => 'quotes-backslash', 'value' => ['s' => 'he said "hi" \\ back']],
    ['label' => 'nested',           'value' => ['a' => ['b' => ['c' => 'x/y']]]],
    ['label' => 'empty-values',     'value' => ['a' => '', 'b' => []]],
    // Boundary cases the port must not guess at:
    ['label' => 'del-char',         'value' => ['s' => "before\x7fafter"]],
    ['label' => 'low-control',      'value' => ['s' => "\x00\x01\x1f"]],
    ['label' => 'html-chars',       'value' => ['s' => '<a href="x">&amp;</a> \'quoted\'']],
    ['label' => 'ascii-boundary',   'value' => ['s' => "\x7e\x7f"]],
    ['label' => 'base64-alphabet',  'value' => ['s' => 'abc+def/ghi=']],
];

$jsonVectors = [];
foreach ($jsonCases as $c) {
    $jsonVectors[] = [
        'label'   => $c['label'],
        'value'   => $c['value'],
        'encoded' => json_encode($c['value']),
    ];
}

/**
 * Empirical check of a STRUCTURAL property the port relies on.
 *
 * The inner base64 emits only ASCII bytes (< 0x80), so when re-encoded the
 * six-bit groups are bounded: g1 <= 31, g2 <= 55, g3 <= 61, and g4 = 63 would
 * require a source byte of 0x3F/0x7F (and g4 = 62 a byte of 0x3E/0x7E), none
 * of which occur in the base64 alphabet. Indices 62 ('+') and 63 ('/') are
 * therefore unreachable, so json_encode never has a slash to escape in the
 * password field. Asserted here rather than assumed.
 */
$trials = 20000;
$plusOrSlashHits = 0;
$charset = [];
for ($i = 0; $i < $trials; $i++) {
    $sample = $aes->encrypt(
        bin2hex(random_bytes(random_int(1, 48))),
        $key,
        substr(md5((string) $i), 0, 16)
    );
    if (str_contains($sample, '+') || str_contains($sample, '/')) {
        $plusOrSlashHits++;
    }
    foreach (str_split($sample) as $ch) {
        $charset[$ch] = true;
    }
}
ksort($charset);

$structuralProperty = [
    'description'      => 'double-base64 output never contains + or /',
    'trials'           => $trials,
    'plusOrSlashHits'  => $plusOrSlashHits,
    'holds'            => $plusOrSlashHits === 0,
    'observedCharset'  => implode('', array_keys($charset)),
];

$fixture = [
    '_comment'   => 'GENERATED FILE - do not edit by hand. Run: php tools/php-parity/generate-vectors.php',
    'phpVersion' => PHP_VERSION,
    'cipher'     => 'AES-256-CBC',
    'secret'     => $secret,
    'key'        => $key,
    'clientId'   => $clientId,
    'aesVectors'         => $aesVectors,
    'loginPayloads'      => $loginPayloads,
    'jsonVectors'        => $jsonVectors,
    'structuralProperty' => $structuralProperty,
];

$outDir = __DIR__ . '/../../src/lib/account-center/__fixtures__';
if (! is_dir($outDir)) {
    mkdir($outDir, 0777, true);
}
$outFile = $outDir . '/php-vectors.json';

file_put_contents(
    $outFile,
    json_encode($fixture, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n"
);

// Human-readable summary so regressions are obvious at a glance.
$roundTripFailures = array_filter($aesVectors, fn ($v) => ! $v['roundTripOk']);
$slashCases        = array_filter($loginPayloads, fn ($p) => $p['jsonBodyHasEscapedSlash']);

echo 'PHP ' . PHP_VERSION . PHP_EOL;
echo 'AES vectors      : ' . count($aesVectors) . ' (round-trip failures: ' . count($roundTripFailures) . ')' . PHP_EOL;
echo 'Login payloads   : ' . count($loginPayloads) . ' (escaped slash in ' . count($slashCases) . ')' . PHP_EOL;
echo 'json_encode      : ' . count($jsonVectors) . ' vectors' . PHP_EOL;
echo 'Structural check : ' . $trials . ' trials, +// hits = ' . $plusOrSlashHits
    . ' -> property ' . ($structuralProperty['holds'] ? 'HOLDS' : 'VIOLATED') . PHP_EOL;
echo 'Observed charset : ' . $structuralProperty['observedCharset'] . PHP_EOL;
echo 'Output           : ' . realpath($outFile) . PHP_EOL;
