<?php

declare(strict_types=1);

namespace MivaFix;

use PDO;

final class Auth
{
    public function __construct(private PDO $db) {}

    public function user(): ?array
    {
        if (empty($_SESSION['user_id'])) return null;
        $statement = $this->db->prepare('SELECT u.id, u.full_name, u.email, u.phone, u.role_id, r.name AS role, u.is_active FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1');
        $statement->execute([(int) $_SESSION['user_id']]);
        $user = $statement->fetch();
        if (!$user || !(bool) $user['is_active']) return null;
        unset($user['is_active']);
        return $user;
    }

    public function requireUser(): array
    {
        $user = $this->user();
        if (!$user) Response::error('Please sign in to continue.', 401);
        return $user;
    }

    public function requireRole(array $roles): array
    {
        $user = $this->requireUser();
        if (!in_array($user['role'], $roles, true)) Response::error('You do not have permission to perform this action.', 403);
        return $user;
    }

    public function login(string $email, string $password): ?array
    {
        $statement = $this->db->prepare('SELECT u.*, r.name AS role FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.email = ? LIMIT 1');
        $statement->execute([strtolower(trim($email))]);
        $record = $statement->fetch();
        if (!$record || !(bool) $record['is_active'] || !password_verify($password, $record['password_hash'])) return null;
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $record['id'];
        unset($record['password_hash'], $record['is_active']);
        return $record;
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
    }
}
