<?php

namespace App\Library;

/**
 * AesCbc256 (Algorithm) Library
 *
 * Advanced Encryption Standard, with CBC 256.
 *
 * VERBATIM COPY of the customer's production Laravel library.
 * Do not modify. This file is the reference implementation that
 * src/lib/account-center/crypto.ts must match byte-for-byte.
 *
 * @since v1.0 Sep, 2023
 */
class AesCbc256
{
    /**
     * Cipher Algorithm
     */
    protected string $cipher = 'AES-256-CBC';

    /**
     * Hash Method Algorithm
     */
    protected string $hashMethod = 'sha256';

    /**
     * Binary Status
     */
    protected bool $binaryStatus = false;

    /**
     * getIV(): string
     *
     * IV key for cipher
     *
     * @return string Binary string key for cipher
     */
    public function getIV()
    {
        $iv_length = openssl_cipher_iv_length($this->cipher);
        $iv = substr(md5(uniqid()), 0, $iv_length);

        return $iv;
    }

    /**
     * encrypt(string $str, string $key, string $iv): string
     *
     * @param  string  $str  Data to encrypt
     * @param  string  $key  Account Center Secret key
     * @param  string  $iv  Binary string key for cipher
     * @return string Base64 string data
     */
    public function encrypt(string $str, string $key, $iv)
    {
        if (is_array($str) || is_object($str)) {
            $str = json_encode($str);
        }
        $raw = openssl_encrypt($str, $this->cipher, $key, $this->binaryStatus, $iv);
        $base64_string = base64_encode($raw);

        return $base64_string;
    }

    /**
     * decrypt(string $str, string $key, $iv): string
     *
     * @param  string  $str  Data to encrypt
     * @param  string  $key  Account Center Secret key
     * @param  string  $iv  Binary string key for cipher
     * @return string Raw string data
     */
    public function decrypt(string $str, string $key, $iv)
    {
        $base64_string = base64_decode($str);
        $iv = base64_decode($iv);
        $raw = openssl_decrypt($base64_string, $this->cipher, $key, $this->binaryStatus, $iv);

        return $raw;
    }
}

/* End of file AesCbc256.php */
/* Location: .//app/Library/AesCbc256.php */
