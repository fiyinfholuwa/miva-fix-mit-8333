<?php

declare(strict_types=1);

namespace MivaFix;

final class Request
{
    private array $body;

    public function __construct()
    {
        $raw = file_get_contents('php://input') ?: '';
        $decoded = json_decode($raw, true);
        $this->body = is_array($decoded) ? $decoded : $_POST;
    }

    public function method(): string { return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'); }

    public function path(): string
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        return '/' . trim(preg_replace('#^/index\.php#', '', $uri), '/');
    }

    public function input(string $key, mixed $default = null): mixed { return $this->body[$key] ?? $default; }
    public function all(): array { return $this->body; }
    public function file(string $key): ?array { return isset($_FILES[$key]) && is_array($_FILES[$key]) ? $_FILES[$key] : null; }
    public function query(string $key, mixed $default = null): mixed { return $_GET[$key] ?? $default; }
}
