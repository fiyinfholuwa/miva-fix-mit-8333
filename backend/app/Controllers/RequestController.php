<?php

declare(strict_types=1);

namespace MivaFix\Controllers;

use MivaFix\Auth;
use MivaFix\Request;
use MivaFix\Response;
use PDO;

final class RequestController
{
    private const STATUSES = ['submitted', 'assigned', 'in_progress', 'completed', 'cancelled'];
    private const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    public function __construct(private PDO $db, private Auth $auth) {}

    public function categories(): void
    {
        $this->auth->requireUser();
        Response::json(['success' => true, 'categories' => $this->db->query('SELECT id, name, description FROM categories ORDER BY name')->fetchAll()]);
    }

    public function index(Request $request): void
    {
        $user = $this->auth->requireUser();
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(50, max(1, (int) $request->query('limit', 8)));
        $offset = ($page - 1) * $limit;
        $where = [];
        $params = [];

        if ($user['role'] === 'student_staff') {
            $where[] = 'sr.user_id = ?';
            $params[] = $user['id'];
        } elseif ($user['role'] === 'maintenance_officer') {
            $where[] = 'a.officer_id = ?';
            $params[] = $user['id'];
        }
        $search = trim((string) $request->query('q', ''));
        if ($search !== '') {
            $where[] = '(sr.ticket_no LIKE ? OR sr.title LIKE ? OR sr.location LIKE ?)';
            array_push($params, "%$search%", "%$search%", "%$search%");
        }
        if ($request->query('status')) {
            $where[] = 'sr.status = ?';
            $params[] = (string) $request->query('status');
        }
        if ($request->query('category')) {
            $where[] = 'sr.category_id = ?';
            $params[] = (int) $request->query('category');
        }

        $filter = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $countQuery = $this->db->prepare("SELECT COUNT(DISTINCT sr.id) FROM service_requests sr LEFT JOIN assignments a ON a.request_id = sr.id $filter");
        $countQuery->execute($params);
        $total = (int) $countQuery->fetchColumn();
        $sql = "SELECT sr.id, sr.ticket_no, sr.title, sr.description, sr.location, sr.priority, sr.status, sr.evidence_path,
                       sr.created_at, sr.updated_at, c.name AS category, u.full_name AS requester,
                       officer.full_name AS officer_name
                FROM service_requests sr INNER JOIN categories c ON c.id = sr.category_id
                INNER JOIN users u ON u.id = sr.user_id LEFT JOIN assignments a ON a.request_id = sr.id
                LEFT JOIN users officer ON officer.id = a.officer_id $filter
                GROUP BY sr.id ORDER BY sr.created_at DESC LIMIT $limit OFFSET $offset";
        $query = $this->db->prepare($sql);
        $query->execute($params);
        Response::json(['success' => true, 'requests' => $query->fetchAll(), 'pagination' => ['page' => $page, 'limit' => $limit, 'total' => $total, 'pages' => (int) ceil($total / $limit)]]);
    }

    public function show(Request $request, string $id): void
    {
        $user = $this->auth->requireUser();
        $query = $this->db->prepare('SELECT sr.*, c.name AS category, u.full_name AS requester, u.email AS requester_email, officer.full_name AS officer_name FROM service_requests sr INNER JOIN categories c ON c.id = sr.category_id INNER JOIN users u ON u.id = sr.user_id LEFT JOIN assignments a ON a.request_id = sr.id LEFT JOIN users officer ON officer.id = a.officer_id WHERE sr.id = ? LIMIT 1');
        $query->execute([(int) $id]);
        $record = $query->fetch();
        if (!$record) Response::error('Request not found.', 404);
        if ($user['role'] === 'student_staff' && (int) $record['user_id'] !== (int) $user['id']) Response::error('You cannot view this request.', 403);
        $logs = $this->db->prepare('SELECT su.status, su.note, su.created_at, u.full_name AS actor FROM status_updates su INNER JOIN users u ON u.id = su.user_id WHERE su.request_id = ? ORDER BY su.created_at DESC');
        $logs->execute([(int) $id]);
        $record['updates'] = $logs->fetchAll();
        Response::json(['success' => true, 'request' => $record]);
    }

    public function store(Request $request): void
    {
        $user = $this->auth->requireRole(['student_staff', 'administrator']);
        $title = trim((string) $request->input('title'));
        $description = trim((string) $request->input('description'));
        $category = (int) $request->input('category_id');
        $location = trim((string) $request->input('location'));
        $priority = (string) $request->input('priority', 'medium');
        $errors = [];
        if (mb_strlen($title) < 5) $errors['title'] = 'Title must be at least 5 characters.';
        if (mb_strlen($description) < 15) $errors['description'] = 'Please provide more detail.';
        if (!$category) $errors['category_id'] = 'Select a category.';
        if (!$location) $errors['location'] = 'Enter the affected location.';
        if (!in_array($priority, self::PRIORITIES, true)) $errors['priority'] = 'Select a valid priority.';
        if ($errors) Response::error('Please correct the highlighted fields.', 422, $errors);

        $evidencePath = $this->storeEvidence($request->file('evidence'));
        $ticket = 'MFX-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
        $insert = $this->db->prepare('INSERT INTO service_requests (ticket_no, user_id, category_id, title, description, location, priority, evidence_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $insert->execute([$ticket, $user['id'], $category, $title, $description, $location, $priority, $evidencePath]);
        $id = (int) $this->db->lastInsertId();
        $this->log($id, (int) $user['id'], 'submitted', 'Request submitted by requester.');
        $this->notifyRole('administrator', $id, "New request $ticket was submitted.");
        Response::json(['success' => true, 'message' => "Request $ticket submitted.", 'id' => $id], 201);
    }

    public function evidence(Request $request, string $id): void
    {
        $user = $this->auth->requireUser();
        $record = $this->find((int) $id);
        if (!$record) Response::error('Request not found.', 404);
        if ($user['role'] === 'student_staff' && (int) $record['user_id'] !== (int) $user['id']) Response::error('You cannot view this evidence.', 403);
        if ($user['role'] === 'maintenance_officer' && !$this->isAssigned((int) $id, (int) $user['id'])) Response::error('This request is not assigned to you.', 403);
        if (empty($record['evidence_path'])) Response::error('No evidence was uploaded for this request.', 404);

        $uploadsRoot = realpath(__DIR__ . '/../../uploads');
        $filePath = $uploadsRoot ? realpath(__DIR__ . '/../../' . $record['evidence_path']) : false;
        if (!$uploadsRoot || !$filePath || strncmp($filePath, $uploadsRoot . DIRECTORY_SEPARATOR, strlen($uploadsRoot . DIRECTORY_SEPARATOR)) !== 0 || !is_file($filePath)) Response::error('Evidence file not found.', 404);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($filePath) ?: 'application/octet-stream';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string) filesize($filePath));
        header('Content-Disposition: inline; filename="' . basename($filePath) . '"');
        readfile($filePath);
        exit;
    }

    public function update(Request $request, string $id): void
    {
        $user = $this->auth->requireRole(['student_staff', 'administrator']);
        $existing = $this->find((int) $id);
        if (!$existing) Response::error('Request not found.', 404);
        if ($user['role'] === 'student_staff' && (int) $existing['user_id'] !== (int) $user['id']) Response::error('You cannot update this request.', 403);
        if (!in_array($existing['status'], ['submitted', 'assigned'], true)) Response::error('Only newly submitted requests can be edited.', 409);
        $fields = [];
        $values = [];
        foreach (['title', 'description', 'location', 'priority'] as $field) {
            if ($request->input($field) !== null) {
                $fields[] = "$field = ?";
                $values[] = trim((string) $request->input($field));
            }
        }
        if (!$fields) Response::error('No changes were submitted.', 422);
        $values[] = (int) $id;
        $this->db->prepare('UPDATE service_requests SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);
        Response::json(['success' => true, 'message' => 'Request updated.']);
    }

    public function destroy(Request $request, string $id): void
    {
        $this->auth->requireRole(['administrator']);
        if (!$this->find((int) $id)) Response::error('Request not found.', 404);
        $this->db->prepare('DELETE FROM service_requests WHERE id = ?')->execute([(int) $id]);
        Response::json(['success' => true, 'message' => 'Request removed by administrator.']);
    }

    public function assign(Request $request, string $id): void
    {
        $admin = $this->auth->requireRole(['administrator']);
        $officerId = (int) $request->input('officer_id');
        $officer = $this->db->prepare("SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND r.name = 'maintenance_officer'");
        $officer->execute([$officerId]);
        if (!$officer->fetch()) Response::error('Select a valid maintenance officer.', 422);
        $existing = $this->find((int) $id);
        if (!$existing) Response::error('Request not found.', 404);
        $this->db->prepare('INSERT INTO assignments (request_id, officer_id, assigned_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE officer_id = VALUES(officer_id), assigned_by = VALUES(assigned_by), assigned_at = CURRENT_TIMESTAMP')->execute([(int) $id, $officerId, $admin['id']]);
        $this->db->prepare("UPDATE service_requests SET status = 'assigned' WHERE id = ?")->execute([(int) $id]);
        $this->log((int) $id, (int) $admin['id'], 'assigned', 'Request assigned to a maintenance officer.');
        $this->notifyUser($officerId, (int) $id, "You were assigned request {$existing['ticket_no']}.");
        $this->notifyUser((int) $existing['user_id'], (int) $id, "Your request {$existing['ticket_no']} was assigned to a maintenance officer.");
        Response::json(['success' => true, 'message' => 'Request assigned successfully.']);
    }

    public function status(Request $request, string $id): void
    {
        $user = $this->auth->requireRole(['maintenance_officer', 'administrator']);
        $status = (string) $request->input('status');
        if (!in_array($status, self::STATUSES, true)) Response::error('Invalid status.', 422);
        $existing = $this->find((int) $id);
        if (!$existing) Response::error('Request not found.', 404);
        if ($user['role'] === 'maintenance_officer' && !$this->isAssigned((int) $id, (int) $user['id'])) Response::error('This request is not assigned to you.', 403);
        $allowedStatuses = $user['role'] === 'maintenance_officer'
            ? ['assigned', 'in_progress', 'completed']
            : self::STATUSES;
        if (!in_array($status, $allowedStatuses, true)) {
            Response::error('This status is not available for your role.', 403);
        }
        $this->db->prepare('UPDATE service_requests SET status = ? WHERE id = ?')->execute([$status, (int) $id]);
        $note = trim((string) $request->input('note', 'Status updated.'));
        $this->log((int) $id, (int) $user['id'], $status, $note);
        $label = ucfirst(str_replace('_', ' ', $status));
        $this->notifyUser((int) $existing['user_id'], (int) $id, "Request {$existing['ticket_no']} is now $label.");
        $assignedOfficer = $this->assignedOfficerId((int) $id);
        if ($assignedOfficer && $assignedOfficer !== (int) $user['id']) $this->notifyUser($assignedOfficer, (int) $id, "Request {$existing['ticket_no']} was updated to $label.");
        if ($user['role'] !== 'administrator') $this->notifyRole('administrator', (int) $id, "Request {$existing['ticket_no']} was updated to $label.");
        Response::json(['success' => true, 'message' => 'Request status updated.']);
    }

    private function storeEvidence(?array $file): ?string
    {
        if (!$file || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
        if ((int) ($file['error'] ?? 0) !== UPLOAD_ERR_OK) Response::error('The evidence upload failed.', 422);
        if ((int) ($file['size'] ?? 0) > 5 * 1024 * 1024) Response::error('Evidence images must be 5 MB or smaller.', 422);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']);
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];
        if (!isset($extensions[$mime])) Response::error('Upload a JPG, PNG, GIF or WEBP evidence image.', 422);
        $directory = __DIR__ . '/../../uploads';
        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) Response::error('Evidence storage is unavailable.', 500);
        $filename = 'evidence-' . bin2hex(random_bytes(12)) . '.' . $extensions[$mime];
        if (!move_uploaded_file((string) $file['tmp_name'], $directory . DIRECTORY_SEPARATOR . $filename)) Response::error('The evidence image could not be saved.', 500);
        return 'uploads/' . $filename;
    }

    private function find(int $id): ?array
    {
        $query = $this->db->prepare('SELECT * FROM service_requests WHERE id = ? LIMIT 1');
        $query->execute([$id]);
        return $query->fetch() ?: null;
    }

    private function isAssigned(int $requestId, int $officerId): bool
    {
        $query = $this->db->prepare('SELECT id FROM assignments WHERE request_id = ? AND officer_id = ?');
        $query->execute([$requestId, $officerId]);
        return (bool) $query->fetchColumn();
    }

    private function assignedOfficerId(int $requestId): ?int
    {
        $query = $this->db->prepare('SELECT officer_id FROM assignments WHERE request_id = ? LIMIT 1');
        $query->execute([$requestId]);
        $officerId = $query->fetchColumn();
        return $officerId === false ? null : (int) $officerId;
    }

    private function notifyUser(int $userId, int $requestId, string $message): void
    {
        $this->db->prepare('INSERT INTO notifications (user_id, request_id, message) VALUES (?, ?, ?)')->execute([$userId, $requestId, $message]);
    }

    private function notifyRole(string $role, int $requestId, string $message): void
    {
        $query = $this->db->prepare("SELECT u.id FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE r.name = ? AND u.is_active = 1");
        $query->execute([$role]);
        foreach ($query->fetchAll() as $row) $this->notifyUser((int) $row['id'], $requestId, $message);
    }

    private function log(int $requestId, int $userId, string $status, string $note): void
    {
        $this->db->prepare('INSERT INTO status_updates (request_id, user_id, status, note) VALUES (?, ?, ?, ?)')->execute([$requestId, $userId, $status, $note]);
    }
}
