<?php

declare(strict_types=1);

namespace MivaFix\Controllers;

use MivaFix\Auth;
use MivaFix\Request;
use MivaFix\Response;
use PDO;

final class AuthController
{
    public function __construct(private PDO $db, private Auth $auth) {}

    public function register(Request $request): void
    {
        $name = trim((string) $request->input('full_name'));
        $email = strtolower(trim((string) $request->input('email')));
        $password = (string) $request->input('password');
        $phone = trim((string) $request->input('phone', ''));
        $errors = [];
        if (mb_strlen($name) < 2) $errors['full_name'] = 'Enter your full name.';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Enter a valid email address.';
        if (strlen($password) < 8) $errors['password'] = 'Password must be at least 8 characters.';
        if ($errors) Response::error('Please correct the highlighted fields.', 422, $errors);

        $role = $this->db->query("SELECT id FROM roles WHERE name = 'student_staff' LIMIT 1")->fetchColumn();
        $statement = $this->db->prepare('INSERT INTO users (role_id, full_name, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)');
        try {
            $statement->execute([$role, $name, $email, $phone ?: null, password_hash($password, PASSWORD_DEFAULT)]);
        } catch (\PDOException $exception) {
            if ((int) ($exception->errorInfo[1] ?? 0) === 1062) Response::error('An account with this email already exists.', 409);
            throw $exception;
        }
        $_SESSION['user_id'] = (int) $this->db->lastInsertId();
        Response::json(['success' => true, 'message' => 'Account created successfully.', 'user' => $this->auth->user()], 201);
    }

    public function login(Request $request): void
    {
        $user = $this->auth->login((string) $request->input('email'), (string) $request->input('password'));
        if (!$user) Response::error('Email or password is incorrect.', 401);
        Response::json(['success' => true, 'message' => 'Welcome back.', 'user' => $this->auth->user()]);
    }

    public function logout(): void
    {
        $this->auth->logout();
        Response::json(['success' => true, 'message' => 'You have been signed out.']);
    }

    public function me(): void
    {
        $user = $this->auth->user();
        Response::json(['success' => true, 'authenticated' => (bool) $user, 'user' => $user]);
    }
}
