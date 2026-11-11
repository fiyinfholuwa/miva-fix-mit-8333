<?php

declare(strict_types=1);

$configPath = __DIR__ . '/../config/config.php';
if (!file_exists($configPath)) {
    fwrite(STDERR, "Missing backend/config/config.php. Copy config.example.php first.\n");
    exit(1);
}

$config = require $configPath;
$db = $config['db'];
$database = $db['database'];
if (!preg_match('/^[a-zA-Z0-9_]+$/', $database)) {
    fwrite(STDERR, "Invalid database name in config.php.\n");
    exit(1);
}

$serverDsn = sprintf('mysql:host=%s;port=%d;charset=%s', $db['host'], $db['port'], $db['charset']);
$pdo = new PDO($serverDsn, $db['username'], $db['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_EMULATE_PREPARES => false,
]);
$pdo->exec("CREATE DATABASE IF NOT EXISTS `$database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("USE `$database`");

$schema = file_get_contents(__DIR__ . '/schema.sql');
if ($schema === false) throw new RuntimeException('Could not read schema.sql.');
$schema = preg_replace('/CREATE DATABASE IF NOT EXISTS[^;]+;|USE [^;]+;/i', '', $schema);
$pdo->exec($schema);

echo "Database and tables installed successfully.\n";
require __DIR__ . '/seed.php';
