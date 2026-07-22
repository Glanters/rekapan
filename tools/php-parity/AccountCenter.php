<?php

namespace App\Library;

use Illuminate\Support\Facades\Http;

/**
 * VERBATIM COPY of the customer's production Laravel library.
 *
 * Kept here as the reference the TypeScript port was written against:
 *   - src/lib/account-center/signing.ts  (body + header construction)
 *   - src/server/account-center/client.ts (the /auth/login endpoint path)
 *
 * Do not modify.
 */
class AccountCenter
{
    protected AesCbc256 $aes;

    protected string $key;

    protected string $iv;

    public function __construct()
    {
        $this->aes = new AesCbc256;
        $this->key = md5(config('services.accountcenter.secret'));
        $this->iv = $this->aes->getIV();
    }

    public static function login(string $email, string $password)
    {
        $self = new static;

        $body = [
            'email' => $email,
            'password' => $self->aes->encrypt($password, $self->key, $self->iv),
        ];

        $jsonBody = json_encode($body);
        $signature = $self->aes->encrypt($jsonBody, $self->key, $self->iv);

        $response = Http::withHeaders([
            'X-Client-Id' => config('services.accountcenter.name'),
            'X-Client-Iv' => base64_encode($self->iv),
            'Signature' => $signature,
        ])
            ->withBody($jsonBody, 'application/json')
            ->post(config('services.accountcenter.uri').'/auth/login');

        return $response->object();
    }
}
