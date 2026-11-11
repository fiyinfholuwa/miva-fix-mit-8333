<?php

declare(strict_types=1);

$configPath = __DIR__ . '/../config/config.php';
$config = file_exists($configPath) ? require $configPath : require __DIR__ . '/../config/config.example.php';
$db = $config['db'];
$dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $db['host'], $db['port'], $db['database'], $db['charset']);
$pdo = new PDO($dsn, $db['username'], $db['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);

$roles = [['student_staff', 'Student / Staff'], ['maintenance_officer', 'Maintenance Officer'], ['administrator', 'Administrator']];
$roleIds = [];
$roleStatement = $pdo->prepare('INSERT INTO roles (name, label) VALUES (?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label)');
foreach ($roles as [$name, $label]) {
    $roleStatement->execute([$name, $label]);
    $lookup = $pdo->prepare('SELECT id FROM roles WHERE name = ?');
    $lookup->execute([$name]);
    $roleIds[$name] = (int) $lookup->fetchColumn();
}

$categories = [
    ['Electrical', 'Power, lighting, sockets and electrical faults.'],
    ['Plumbing', 'Leaking pipes, blocked drains and water supply.'],
    ['Furniture', 'Desks, chairs, doors and classroom furniture.'],
    ['Internet & ICT', 'Network, Wi-Fi, projectors and technology issues.'],
    ['Hostel', 'Hostel rooms, common areas and accommodation issues.'],
];
$categoryStatement = $pdo->prepare('INSERT INTO categories (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)');
foreach ($categories as $category) $categoryStatement->execute($category);

$users = [['Administrator', 'admin@miva.test', 'administrator'], ['Maintenance Officer', 'officer@miva.test', 'maintenance_officer'], ['Demo Student', 'student@miva.test', 'student_staff']];
$userStatement = $pdo->prepare('INSERT INTO users (role_id, full_name, email, password_hash) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), full_name = VALUES(full_name)');
foreach ($users as [$name, $email, $role]) $userStatement->execute([$roleIds[$role], $name, $email, password_hash('Password123!', PASSWORD_DEFAULT)]);

$requestCount = (int) $pdo->query('SELECT COUNT(*) FROM service_requests')->fetchColumn();
if ($requestCount === 0) {
    $userId = static function (PDO $pdo, string $email): int {
        $query = $pdo->prepare('SELECT id FROM users WHERE email = ?');
        $query->execute([$email]);
        return (int) $query->fetchColumn();
    };
    $categoryId = static function (PDO $pdo, string $name): int {
        $query = $pdo->prepare('SELECT id FROM categories WHERE name = ?');
        $query->execute([$name]);
        return (int) $query->fetchColumn();
    };
    $studentId = $userId($pdo, 'student@miva.test');
    $officerId = $userId($pdo, 'officer@miva.test');
    $adminId = $userId($pdo, 'admin@miva.test');
    $sampleRequests = [
        ['MFX-DEMO-001', $studentId, $categoryId($pdo, 'Internet & ICT'), 'Wi-Fi signal drops in library', 'The library Wi-Fi disconnects every few minutes, especially near the second-floor reading area.', 'Main Library, Floor 2', 'high', 'in_progress'],
        ['MFX-DEMO-002', $studentId, $categoryId($pdo, 'Furniture'), 'Broken chair in seminar room', 'One of the front-row chairs has a loose backrest and is unsafe to use.', 'Block B, Seminar Room 1', 'medium', 'assigned'],
        ['MFX-DEMO-003', $studentId, $categoryId($pdo, 'Electrical'), 'Light not working in Lab 2', 'The third ceiling light in the computer lab is not turning on.', 'ICT Block, Lab 2', 'low', 'completed'],
        ['MFX-DEMO-004', $studentId, $categoryId($pdo, 'Plumbing'), 'Leaking pipe under washroom sink', 'Water is dripping steadily from the pipe under the second sink and pooling on the floor.', 'Faculty of Science, Ground Floor Washroom', 'urgent', 'submitted'],
        ['MFX-DEMO-005', $studentId, $categoryId($pdo, 'Hostel'), 'Hostel room door lock is jammed', 'The key turns but the lock does not release, so the door cannot be locked when leaving.', 'Hostel Block C, Room 214', 'high', 'submitted'],
        ['MFX-DEMO-006', $studentId, $categoryId($pdo, 'Internet & ICT'), 'Projector not displaying in Lecture Hall 3', 'The projector powers on but shows "no signal" from both HDMI and VGA inputs.', 'Lecture Hall 3', 'medium', 'assigned'],
    ];
    $insertRequest = $pdo->prepare('INSERT INTO service_requests (ticket_no, user_id, category_id, title, description, location, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $insertAssignment = $pdo->prepare('INSERT INTO assignments (request_id, officer_id, assigned_by) VALUES (?, ?, ?)');
    $insertLog = $pdo->prepare('INSERT INTO status_updates (request_id, user_id, status, note) VALUES (?, ?, ?, ?)');
    foreach ($sampleRequests as [$ticket, $requester, $category, $title, $description, $location, $priority, $status]) {
        $insertRequest->execute([$ticket, $requester, $category, $title, $description, $location, $priority, $status]);
        $requestId = (int) $pdo->lastInsertId();
        $insertLog->execute([$requestId, $requester, 'submitted', 'Request submitted by requester.']);
        if ($status !== 'submitted') {
            $insertAssignment->execute([$requestId, $officerId, $adminId]);
            $insertLog->execute([$requestId, $adminId, 'assigned', 'Request assigned to a maintenance officer.']);
        }
        if ($status === 'in_progress') $insertLog->execute([$requestId, $officerId, 'in_progress', 'Officer has started investigating the issue.']);
        if ($status === 'completed') {
            $insertLog->execute([$requestId, $officerId, 'in_progress', 'Replacement part installed and tested.']);
            $insertLog->execute([$requestId, $officerId, 'completed', 'Issue resolved and equipment tested successfully.']);
        }
    }
}

echo "MivaFix seed completed. Demo password: Password123!\n";
