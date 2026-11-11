<?php

declare(strict_types=1);

namespace MivaFix\Controllers;

use MivaFix\Auth;
use MivaFix\Request;
use MivaFix\Response;
use PDO;

final class DashboardController
{
    public function __construct(private PDO $db, private Auth $auth) {}

    public function summary(): void
    {
        $user = $this->auth->requireUser();
        $where = '';
        $params = [];
        if ($user['role'] === 'student_staff') {
            $where = 'WHERE user_id = ?';
            $params[] = $user['id'];
        } elseif ($user['role'] === 'maintenance_officer') {
            $where = 'WHERE id IN (SELECT request_id FROM assignments WHERE officer_id = ?)';
            $params[] = $user['id'];
        }

        $count = $this->db->prepare("SELECT status, COUNT(*) AS total FROM service_requests $where GROUP BY status");
        $count->execute($params);
        $byStatus = array_fill_keys(['submitted', 'assigned', 'in_progress', 'completed', 'cancelled'], 0);
        foreach ($count->fetchAll() as $row) $byStatus[$row['status']] = (int) $row['total'];

        $latest = $this->db->prepare("SELECT id, ticket_no, title, location, status, priority, created_at, updated_at FROM service_requests $where ORDER BY created_at DESC LIMIT 5");
        $latest->execute($params);
        $unread = $this->db->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0');
        $unread->execute([$user['id']]);
        Response::json(['success' => true, 'summary' => ['total' => array_sum($byStatus), 'by_status' => $byStatus, 'latest' => $latest->fetchAll(), 'unread_notifications' => (int) $unread->fetchColumn()]]);
    }

    public function notifications(Request $request): void
    {
        $user = $this->auth->requireUser();
        $limit = min(50, max(1, (int) $request->query('limit', 30)));
        $query = $this->db->prepare("SELECT n.id, n.request_id, n.message, n.is_read, n.created_at, sr.ticket_no FROM notifications n LEFT JOIN service_requests sr ON sr.id = n.request_id WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT $limit");
        $query->execute([$user['id']]);
        Response::json(['success' => true, 'notifications' => $query->fetchAll()]);
    }

    public function readNotifications(): void
    {
        $user = $this->auth->requireUser();
        $this->db->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')->execute([$user['id']]);
        Response::json(['success' => true, 'message' => 'Notifications marked as read.']);
    }
}
