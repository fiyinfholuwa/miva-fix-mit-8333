<?php

declare(strict_types=1);

/**
 * MivaFix API integration tests.
 *
 * Exercises every REST endpoint over real HTTP against a running API and database,
 * using a separate cookie jar (session) for each role.
 *
 * Usage:  php tests/api/ApiTest.php [base-url]
 * Default base URL: http://localhost:8000/api  (or env MIVAFIX_API)
 * Requires the seeded demo accounts (php backend/database/install.php).
 */

$base = rtrim($argv[1] ?? getenv('MIVAFIX_API') ?: 'http://localhost:8000/api', '/');
$jarDir = sys_get_temp_dir() . '/mivafix-tests-' . getmypid();
@mkdir($jarDir);
$results = [];
$run = bin2hex(random_bytes(3));

function http(string $method, string $path, array $opts = []): array
{
    global $base, $jarDir;
    $ch = curl_init($base . $path);
    $headers = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
            if (str_contains($line, ':')) { [$k, $v] = explode(':', $line, 2); $headers[strtolower(trim($k))] = trim($v); }
            return strlen($line);
        },
    ]);
    if (isset($opts['as'])) {
        $jar = "$jarDir/{$opts['as']}.txt";
        curl_setopt($ch, CURLOPT_COOKIEJAR, $jar);
        curl_setopt($ch, CURLOPT_COOKIEFILE, $jar);
    }
    if (isset($opts['json'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($opts['json']));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    } elseif (isset($opts['multipart'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $opts['multipart']);
    }
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['status' => $status, 'body' => (string) $body, 'json' => json_decode((string) $body, true), 'headers' => $headers];
}

function test(string $group, string $name, callable $fn): void
{
    global $results;
    try {
        $fn();
        $results[] = [$group, $name, true, ''];
        echo "  \033[32m✓\033[0m $name\n";
    } catch (Throwable $e) {
        $results[] = [$group, $name, false, $e->getMessage()];
        echo "  \033[31m✗ $name\033[0m\n    → {$e->getMessage()}\n";
    }
}

function expect(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function expectStatus(array $res, int $code): void { expect($res['status'] === $code, "expected HTTP $code, got {$res['status']}: " . substr($res['body'], 0, 160)); }

$section = function (string $title) { echo "\n\033[1m$title\033[0m\n"; return $title; };

// A tiny valid PNG used as evidence.
$png = sys_get_temp_dir() . "/mivafix-evidence-$run.png";
file_put_contents($png, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='));
$txt = sys_get_temp_dir() . "/mivafix-evidence-$run.txt";
file_put_contents($txt, 'not an image');

echo "MivaFix API tests against $base\n";

/* ---------------------------------------------------------------- */
$g = $section('Authentication & session management');
$newEmail = "tester.$run@miva.test";

test($g, 'GET /auth/me reports unauthenticated without a session', function () {
    $r = http('GET', '/auth/me', ['as' => 'anon']);
    expectStatus($r, 200);
    expect($r['json']['authenticated'] === false, 'should be unauthenticated');
});
test($g, 'POST /auth/register rejects invalid input with field errors (422)', function () {
    $r = http('POST', '/auth/register', ['as' => 'anon', 'json' => ['full_name' => 'A', 'email' => 'bad', 'password' => '123']]);
    expectStatus($r, 422);
    foreach (['full_name', 'email', 'password'] as $f) expect(isset($r['json']['details'][$f]), "missing error for $f");
});
test($g, 'POST /auth/register creates a student/staff account (201)', function () use ($newEmail) {
    $r = http('POST', '/auth/register', ['as' => 'newuser', 'json' => ['full_name' => 'Test Student', 'email' => $newEmail, 'password' => 'Secret123!']]);
    expectStatus($r, 201);
    expect($r['json']['user']['role'] === 'student_staff', 'new users must be student_staff');
    expect(!isset($r['json']['user']['password_hash']), 'password hash must never be returned');
});
test($g, 'POST /auth/register rejects a duplicate email (409)', function () use ($newEmail) {
    $r = http('POST', '/auth/register', ['as' => 'anon', 'json' => ['full_name' => 'Again', 'email' => strtoupper($newEmail), 'password' => 'Secret123!']]);
    expectStatus($r, 409);
});
test($g, 'POST /auth/login rejects a wrong password (401)', function () {
    $r = http('POST', '/auth/login', ['as' => 'anon', 'json' => ['email' => 'student@miva.test', 'password' => 'wrong-password']]);
    expectStatus($r, 401);
});
foreach (['student' => 'student_staff', 'officer' => 'maintenance_officer', 'admin' => 'administrator'] as $who => $role) {
    test($g, "POST /auth/login signs in the $who demo account", function () use ($who, $role) {
        $r = http('POST', '/auth/login', ['as' => $who, 'json' => ['email' => "$who@miva.test", 'password' => 'Password123!']]);
        expectStatus($r, 200);
        expect($r['json']['user']['role'] === $role, "role should be $role");
    });
}
test($g, 'Session cookie is HttpOnly and SameSite=Lax', function () {
    $r = http('POST', '/auth/login', ['as' => 'cookiecheck', 'json' => ['email' => 'student@miva.test', 'password' => 'Password123!']]);
    $cookie = $r['headers']['set-cookie'] ?? '';
    expect(stripos($cookie, 'httponly') !== false, 'HttpOnly flag missing');
    expect(stripos($cookie, 'samesite=lax') !== false, 'SameSite=Lax missing');
});

/* ---------------------------------------------------------------- */
$g = $section('Role-based access control');
test($g, 'Protected routes return 401 without a session', function () {
    foreach (['/dashboard', '/requests', '/categories', '/notifications'] as $p) expectStatus(http('GET', $p, ['as' => 'anon']), 401);
});
test($g, 'Students cannot list users or export reports (403)', function () {
    expectStatus(http('GET', '/users', ['as' => 'student']), 403);
    expectStatus(http('GET', '/export/requests.csv', ['as' => 'student']), 403);
});
test($g, 'Officers cannot create requests (403)', function () {
    expectStatus(http('POST', '/requests', ['as' => 'officer', 'json' => ['title' => 'Officer request', 'description' => 'Should not be allowed at all.', 'category_id' => 1, 'location' => 'X']]), 403);
});

/* ---------------------------------------------------------------- */
$g = $section('Service request CRUD, upload & validation');
$requestId = null; $ticket = null;
test($g, 'GET /categories lists the five seeded categories', function () {
    $r = http('GET', '/categories', ['as' => 'student']);
    expectStatus($r, 200);
    expect(count($r['json']['categories']) >= 5, 'expected at least 5 categories');
});
test($g, 'POST /requests rejects missing fields with field errors (422)', function () {
    $r = http('POST', '/requests', ['as' => 'student', 'json' => ['title' => 'Hi', 'description' => 'short']]);
    expectStatus($r, 422);
    foreach (['title', 'description', 'category_id', 'location'] as $f) expect(isset($r['json']['details'][$f]), "missing error for $f");
});
test($g, 'POST /requests rejects a non-image evidence file (422)', function () use ($txt) {
    $r = http('POST', '/requests', ['as' => 'student', 'multipart' => ['title' => 'Broken tap in hostel', 'description' => 'The tap handle has snapped off completely.', 'category_id' => '2', 'location' => 'Hostel A', 'priority' => 'high', 'evidence' => new CURLFile($txt, 'text/plain', 'notes.txt')]]);
    expectStatus($r, 422);
});
test($g, 'POST /requests creates a request with image evidence (201)', function () use ($png, &$requestId, &$ticket) {
    $r = http('POST', '/requests', ['as' => 'student', 'multipart' => ['title' => 'Broken tap in hostel washroom', 'description' => 'The tap handle has snapped off and water is running continuously.', 'category_id' => '2', 'location' => 'Hostel Block A, Washroom 2', 'priority' => 'urgent', 'evidence' => new CURLFile($png, 'image/png', 'tap.png')]]);
    expectStatus($r, 201);
    $requestId = $r['json']['id'];
    preg_match('/MFX-\d{6}-[A-F0-9]{4}/', $r['json']['message'], $m);
    $ticket = $m[0] ?? null;
    expect($requestId > 0 && $ticket, 'should return id and ticket number');
});
test($g, 'GET /requests/{id} returns details and the initial audit entry', function () use (&$requestId) {
    $r = http('GET', "/requests/$requestId", ['as' => 'student']);
    expectStatus($r, 200);
    expect($r['json']['request']['status'] === 'submitted', 'new request should be submitted');
    expect(count($r['json']['request']['updates']) === 1, 'should have one audit entry');
});
test($g, 'GET /requests/{id}/evidence streams the uploaded image to the owner', function () use (&$requestId) {
    $r = http('GET', "/requests/$requestId/evidence", ['as' => 'student']);
    expectStatus($r, 200);
    expect(str_starts_with($r['headers']['content-type'] ?? '', 'image/png'), 'content-type should be image/png');
});
test($g, 'Another student cannot view the request or its evidence (403)', function () use (&$requestId) {
    expectStatus(http('GET', "/requests/$requestId", ['as' => 'newuser']), 403);
    expectStatus(http('GET', "/requests/$requestId/evidence", ['as' => 'newuser']), 403);
});
test($g, 'PATCH /requests/{id} lets the owner edit a submitted request', function () use (&$requestId) {
    $r = http('PATCH', "/requests/$requestId", ['as' => 'student', 'json' => ['location' => 'Hostel Block A, Washroom 3']]);
    expectStatus($r, 200);
    expect(http('GET', "/requests/$requestId", ['as' => 'student'])['json']['request']['location'] === 'Hostel Block A, Washroom 3', 'location not updated');
});
test($g, 'GET /requests/999999 returns 404', function () { expectStatus(http('GET', '/requests/999999', ['as' => 'admin']), 404); });

/* ---------------------------------------------------------------- */
$g = $section('Search, filter & pagination');
test($g, 'Students only see their own requests', function () {
    $r = http('GET', '/requests?limit=50', ['as' => 'newuser']);
    expectStatus($r, 200);
    expect($r['json']['pagination']['total'] === 0, 'new user should see no requests');
});
test($g, 'Search by ticket number returns the matching request', function () use (&$ticket) {
    $r = http('GET', '/requests?q=' . urlencode($ticket), ['as' => 'admin']);
    expect($r['json']['pagination']['total'] === 1 && $r['json']['requests'][0]['ticket_no'] === $ticket, 'search should find exactly one');
});
test($g, 'Status filter returns only matching statuses', function () {
    $r = http('GET', '/requests?status=completed&limit=50', ['as' => 'admin']);
    foreach ($r['json']['requests'] as $row) expect($row['status'] === 'completed', 'non-completed row returned');
});
test($g, 'Pagination honours limit and reports page count', function () {
    $r = http('GET', '/requests?limit=2&page=1', ['as' => 'admin']);
    $p = $r['json']['pagination'];
    expect(count($r['json']['requests']) <= 2 && $p['pages'] === (int) ceil($p['total'] / 2), 'pagination maths incorrect');
});

/* ---------------------------------------------------------------- */
$g = $section('Assignment, status workflow, audit trail & notifications');
$officerId = null;
test($g, 'GET /officers lists active maintenance officers (admin)', function () use (&$officerId) {
    $r = http('GET', '/officers', ['as' => 'admin']);
    expectStatus($r, 200);
    $officerId = $r['json']['officers'][0]['id'] ?? null;
    expect((bool) $officerId, 'no officer returned');
});
test($g, 'Officer cannot update a request not assigned to them (403)', function () use (&$requestId) {
    expectStatus(http('POST', "/requests/$requestId/status", ['as' => 'officer', 'json' => ['status' => 'in_progress']]), 403);
});
test($g, 'Assigning to a non-officer user is rejected (422)', function () use (&$requestId) {
    expectStatus(http('POST', "/requests/$requestId/assign", ['as' => 'admin', 'json' => ['officer_id' => 999999]]), 422);
});
test($g, 'POST /requests/{id}/assign assigns the officer and sets status', function () use (&$requestId, &$officerId) {
    expectStatus(http('POST', "/requests/$requestId/assign", ['as' => 'admin', 'json' => ['officer_id' => $officerId]]), 200);
    expect(http('GET', "/requests/$requestId", ['as' => 'admin'])['json']['request']['status'] === 'assigned', 'status should be assigned');
});
test($g, 'Assigned officer sees the job in their queue', function () use (&$ticket) {
    $r = http('GET', '/requests?q=' . urlencode($ticket), ['as' => 'officer']);
    expect($r['json']['pagination']['total'] === 1, 'officer should see assigned job');
});
test($g, 'Officer moves the job to in progress, then completed', function () use (&$requestId) {
    expectStatus(http('POST', "/requests/$requestId/status", ['as' => 'officer', 'json' => ['status' => 'in_progress', 'note' => 'Plumber on site.']]), 200);
    expectStatus(http('POST', "/requests/$requestId/status", ['as' => 'officer', 'json' => ['status' => 'completed', 'note' => 'Tap replaced and tested.']]), 200);
});
test($g, 'Officer cannot cancel a request (403) and invalid statuses are rejected (422)', function () use (&$requestId) {
    expectStatus(http('POST', "/requests/$requestId/status", ['as' => 'officer', 'json' => ['status' => 'cancelled']]), 403);
    expectStatus(http('POST', "/requests/$requestId/status", ['as' => 'admin', 'json' => ['status' => 'done']]), 422);
});
test($g, 'Audit trail records every step with actor and note', function () use (&$requestId) {
    $updates = http('GET', "/requests/$requestId", ['as' => 'student'])['json']['request']['updates'];
    $statuses = array_column($updates, 'status');
    foreach (['submitted', 'assigned', 'in_progress', 'completed'] as $s) expect(in_array($s, $statuses, true), "missing $s audit entry");
    expect(in_array('Tap replaced and tested.', array_column($updates, 'note'), true), 'officer note not recorded');
});
test($g, 'Requester receives in-app notifications and can mark them read', function () use (&$ticket) {
    $r = http('GET', '/notifications', ['as' => 'student']);
    $mine = array_filter($r['json']['notifications'], fn ($n) => $n['ticket_no'] === $ticket);
    expect(count($mine) >= 3, 'expected assignment + status notifications');
    expectStatus(http('POST', '/notifications/read', ['as' => 'student']), 200);
    expect(http('GET', '/dashboard', ['as' => 'student'])['json']['summary']['unread_notifications'] === 0, 'unread should be 0');
});
test($g, 'GET /dashboard returns role-scoped totals', function () {
    $s = http('GET', '/dashboard', ['as' => 'admin'])['json']['summary'];
    expect($s['total'] === array_sum($s['by_status']), 'total should equal sum of statuses');
    expect(http('GET', '/dashboard', ['as' => 'newuser'])['json']['summary']['total'] === 0, 'new user total should be 0');
});

/* ---------------------------------------------------------------- */
$g = $section('Administration, export & documentation');
test($g, 'GET /users lists users without password hashes (admin)', function () {
    $r = http('GET', '/users', ['as' => 'admin']);
    expectStatus($r, 200);
    expect(!isset($r['json']['users'][0]['password_hash']), 'password hash leaked');
});
test($g, 'GET /export/requests.csv downloads a CSV with header row', function () {
    $r = http('GET', '/export/requests.csv?from=2000-01-01&to=2099-12-31', ['as' => 'admin']);
    expectStatus($r, 200);
    expect(str_starts_with($r['headers']['content-type'] ?? '', 'text/csv'), 'wrong content type');
    expect(str_starts_with($r['body'], 'Ticket,Title,Category'), 'missing CSV header');
});
test($g, 'GET /export/requests.pdf downloads a valid PDF', function () {
    $r = http('GET', '/export/requests.pdf', ['as' => 'admin']);
    expectStatus($r, 200);
    expect(str_starts_with($r['body'], '%PDF-1.4') && str_contains($r['body'], '%%EOF'), 'not a PDF');
});
test($g, 'GET /api/docs returns an OpenAPI 3.0 document', function () {
    $r = http('GET', '/docs');
    expectStatus($r, 200);
    expect($r['json']['openapi'] === '3.0.0' && count($r['json']['paths']) >= 15, 'invalid OpenAPI doc');
});
test($g, 'DELETE /requests/{id} is admin-only and removes the request', function () use (&$requestId) {
    expectStatus(http('DELETE', "/requests/$requestId", ['as' => 'student']), 403);
    expectStatus(http('DELETE', "/requests/$requestId", ['as' => 'admin']), 200);
    expectStatus(http('GET', "/requests/$requestId", ['as' => 'admin']), 404);
});
test($g, 'Unknown routes return a JSON 404', function () {
    $r = http('GET', '/does-not-exist');
    expectStatus($r, 404);
    expect($r['json']['success'] === false, 'should be JSON error');
});
test($g, 'POST /auth/logout ends the session', function () {
    expectStatus(http('POST', '/auth/logout', ['as' => 'newuser']), 200);
    expect(http('GET', '/auth/me', ['as' => 'newuser'])['json']['authenticated'] === false, 'still authenticated');
});

/* ---------------------------------------------------------------- */
array_map('unlink', glob("$jarDir/*") ?: []);
@rmdir($jarDir); @unlink($png); @unlink($txt);
$passed = count(array_filter($results, fn ($r) => $r[2]));
$total = count($results);
echo "\n" . ($passed === $total ? "\033[32m" : "\033[31m") . "$passed / $total API tests passed\033[0m\n";
exit($passed === $total ? 0 : 1);
