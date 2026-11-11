<?php

declare(strict_types=1);

use MivaFix\Auth;
use MivaFix\Database;
use MivaFix\Request;
use MivaFix\Response;
use MivaFix\Router;
use MivaFix\Controllers\AdminController;
use MivaFix\Controllers\AuthController;
use MivaFix\Controllers\DashboardController;
use MivaFix\Controllers\RequestController;

require_once __DIR__ . '/../app/Database.php';
require_once __DIR__ . '/../app/Response.php';
require_once __DIR__ . '/../app/Request.php';
require_once __DIR__ . '/../app/Auth.php';
require_once __DIR__ . '/../app/Router.php';
require_once __DIR__ . '/../app/Controllers/AuthController.php';
require_once __DIR__ . '/../app/Controllers/RequestController.php';
require_once __DIR__ . '/../app/Controllers/DashboardController.php';
require_once __DIR__ . '/../app/Controllers/AdminController.php';

$configPath = __DIR__ . '/../config/config.php';
$config = file_exists($configPath) ? require $configPath : require __DIR__ . '/../config/config.example.php';
date_default_timezone_set($config['app']['timezone']);
session_name($config['app']['session_name']);
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
session_start();

header('Access-Control-Allow-Origin: ' . ($_SERVER['HTTP_ORIGIN'] ?? '*'));
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit;

try {
    $db = Database::connect($config);
    $auth = new Auth($db);
    $router = new Router();
    $authController = new AuthController($db, $auth);
    $requestController = new RequestController($db, $auth);
    $dashboardController = new DashboardController($db, $auth);
    $adminController = new AdminController($db, $auth);

    $router->add('POST', '/api/auth/register', [$authController, 'register']);
    $router->add('POST', '/api/auth/login', [$authController, 'login']);
    $router->add('POST', '/api/auth/logout', [$authController, 'logout']);
    $router->add('GET', '/api/auth/me', [$authController, 'me']);
    $router->add('GET', '/api/dashboard', [$dashboardController, 'summary']);
    $router->add('GET', '/api/notifications', [$dashboardController, 'notifications']);
    $router->add('POST', '/api/notifications/read', [$dashboardController, 'readNotifications']);
    $router->add('GET', '/api/categories', [$requestController, 'categories']);
    $router->add('GET', '/api/requests', [$requestController, 'index']);
    $router->add('POST', '/api/requests', [$requestController, 'store']);
    $router->add('GET', '/api/requests/{id}', [$requestController, 'show']);
    $router->add('GET', '/api/requests/{id}/evidence', [$requestController, 'evidence']);
    $router->add('PATCH', '/api/requests/{id}', [$requestController, 'update']);
    $router->add('DELETE', '/api/requests/{id}', [$requestController, 'destroy']);
    $router->add('POST', '/api/requests/{id}/assign', [$requestController, 'assign']);
    $router->add('POST', '/api/requests/{id}/status', [$requestController, 'status']);
    $router->add('GET', '/api/users', [$adminController, 'users']);
    $router->add('GET', '/api/officers', [$adminController, 'officers']);
    $router->add('GET', '/api/export/requests.csv', [$adminController, 'export']);
    $router->add('GET', '/api/export/requests.pdf', [$adminController, 'exportPdf']);
    $router->add('GET', '/api/docs', [$adminController, 'docs']);
    $router->dispatch(new Request());
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    Response::error('An unexpected server error occurred.', 500);
}
