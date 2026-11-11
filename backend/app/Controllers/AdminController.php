<?php

declare(strict_types=1);

namespace MivaFix\Controllers;

use MivaFix\Auth;
use MivaFix\Request;
use MivaFix\Response;
use PDO;

final class AdminController
{
    public function __construct(private PDO $db, private Auth $auth) {}

    public function users(): void
    {
        $this->auth->requireRole(['administrator']);
        $users = $this->db->query('SELECT u.id, u.full_name, u.email, u.phone, r.name AS role, u.is_active, u.created_at FROM users u INNER JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC')->fetchAll();
        Response::json(['success' => true, 'users' => $users]);
    }

    public function officers(): void
    {
        $this->auth->requireRole(['administrator']);
        $query = $this->db->query("SELECT u.id, u.full_name, u.email FROM users u INNER JOIN roles r ON r.id = u.role_id WHERE r.name = 'maintenance_officer' AND u.is_active = 1 ORDER BY u.full_name");
        Response::json(['success' => true, 'officers' => $query->fetchAll()]);
    }

    public function export(Request $request): void
    {
        $this->auth->requireRole(['administrator']);
        $query = $this->reportQuery($request, 'sr.created_at, sr.updated_at');
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="mivafix-requests.csv"');
        $output = fopen('php://output', 'w');
        fputcsv($output, ['Ticket', 'Title', 'Category', 'Location', 'Priority', 'Status', 'Requester', 'Created', 'Updated'], ',', '"', '\\');
        foreach ($query as $row) fputcsv($output, $row, ',', '"', '\\');
        fclose($output);
        exit;
    }

    public function exportPdf(Request $request): void
    {
        $this->auth->requireRole(['administrator']);
        $range = $this->dateRange($request);
        $rows = $this->reportQuery($request, 'sr.created_at')->fetchAll();
        $pages = array_chunk($rows, 17) ?: [[]];
        $rangeLabel = $this->dateRangeLabel($range);
        $objects = [1 => '<< /Type /Catalog /Pages 2 0 R >>', 2 => '', 3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
        $pageIds = [];
        $nextObject = 4;
        foreach ($pages as $pageNumber => $pageRows) {
            $pageId = $nextObject++;
            $contentId = $nextObject++;
            $pageIds[] = $pageId;
            $stream = $this->pdfReportPage($pageRows, $pageNumber + 1, count($pages), $rangeLabel);
            $objects[$pageId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {$contentId} 0 R >>";
            $objects[$contentId] = "<< /Length " . strlen($stream) . " >>\nstream\n{$stream}endstream";
        }
        $objects[2] = '<< /Type /Pages /Kids [' . implode(' ', array_map(static fn (int $id): string => "$id 0 R", $pageIds)) . '] /Count ' . count($pageIds) . ' >>';
        ksort($objects);
        $pdf = "%PDF-1.4\n";
        $offsets = [];
        foreach ($objects as $id => $object) {
            $offsets[$id] = strlen($pdf);
            $pdf .= "$id 0 obj\n$object\nendobj\n";
        }
        $xref = strlen($pdf);
        $maxObject = max(array_keys($objects));
        $pdf .= "xref\n0 " . ($maxObject + 1) . "\n0000000000 65535 f \n";
        for ($id = 1; $id <= $maxObject; $id++) $pdf .= sprintf('%010d 00000 n ' . "\n", $offsets[$id]);
        $pdf .= "trailer\n<< /Size " . ($maxObject + 1) . " /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="mivafix-requests.pdf"');
        header('Content-Length: ' . strlen($pdf));
        echo $pdf;
        exit;
    }

    private function pdfReportPage(array $rows, int $page, int $totalPages, string $rangeLabel): string
    {
        $navy = [0.09, 0.23, 0.36];
        $coral = [1.0, 0.25, 0.30];
        $lavender = [0.945, 0.957, 0.984];
        $blue = [0.38, 0.47, 0.58];
        $stream = "q {$navy[0]} {$navy[1]} {$navy[2]} rg 0 720 612 72 re f Q\n";
        $stream .= "q {$coral[0]} {$coral[1]} {$coral[2]} rg 45 738 34 34 re f Q\n";
        $stream .= $this->pdfText(56, 749, 18, 'M', [1, 1, 1]);
        $stream .= $this->pdfText(95, 758, 21, 'MivaFix', [1, 1, 1]);
        $stream .= $this->pdfText(95, 741, 9, 'University maintenance service desk', [0.86, 0.91, 0.96]);
        $stream .= $this->pdfText(45, 690, 13, 'Service request report', $navy);
        $stream .= $this->pdfText(45, 674, 9, 'Date range: ' . $rangeLabel . '   |   Generated: ' . date('Y-m-d H:i'), $blue);
        $stream .= "q {$navy[0]} {$navy[1]} {$navy[2]} rg 45 626 522 24 re f Q\n";
        $headers = [['Ticket', 51], ['Request', 126], ['Category', 276], ['Status', 386], ['Priority', 466], ['Created', 526]];
        foreach ($headers as [$label, $x]) $stream .= $this->pdfText($x, 634, 8, $label, [1, 1, 1]);
        $y = 608;
        foreach ($rows as $index => $row) {
            if ($index % 2 === 0) $stream .= "q {$lavender[0]} {$lavender[1]} {$lavender[2]} rg 45 " . ($y - 10) . " 522 24 re f Q\n";
            $stream .= $this->pdfText(51, $y, 8, mb_substr((string) $row['ticket_no'], 0, 13), $coral);
            $stream .= $this->pdfText(126, $y, 8, mb_substr((string) $row['title'], 0, 26), $navy);
            $stream .= $this->pdfText(276, $y, 8, mb_substr((string) $row['category'], 0, 17), $blue);
            $status = ucfirst(str_replace('_', ' ', (string) $row['status']));
            $statusColor = match ($row['status']) {
                'completed' => [0.29, 0.55, 0.41],
                'cancelled' => [0.71, 0.31, 0.31],
                'submitted' => [0.67, 0.48, 0.13],
                default => [0.29, 0.51, 0.62],
            };
            $stream .= $this->pdfText(386, $y, 8, mb_substr($status, 0, 13), $statusColor);
            $stream .= $this->pdfText(466, $y, 8, ucfirst((string) $row['priority']), $blue);
            $stream .= $this->pdfText(526, $y, 8, substr((string) $row['created_at'], 0, 10), $blue);
            $y -= 30;
        }
        if (!$rows) $stream .= $this->pdfText(51, 608, 9, 'No requests found for the selected date range.', $blue);
        $stream .= $this->pdfText(45, 35, 8, 'MivaFix | Facilities / Operations', $blue);
        $stream .= $this->pdfText(530, 35, 8, "Page {$page} of {$totalPages}", $blue);
        return $stream;
    }

    private function pdfText(int $x, int $y, int $size, string $text, array $color): string
    {
        return "q {$color[0]} {$color[1]} {$color[2]} rg BT /F1 {$size} Tf {$x} {$y} Td (" . $this->pdfEscape($text) . ") Tj ET Q\n";
    }

    private function pdfEscape(string $value): string
    {
        $value = preg_replace('/[^\x20-\x7E]/', '?', $value) ?? $value;
        return str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $value);
    }

    private function reportQuery(Request $request, string $dateColumns): \PDOStatement
    {
        [$from, $to] = $this->dateRange($request);

        $where = [];
        $params = [];
        if ($from !== '') { $where[] = 'sr.created_at >= ?'; $params[] = $from . ' 00:00:00'; }
        if ($to !== '') { $where[] = 'sr.created_at < DATE_ADD(?, INTERVAL 1 DAY)'; $params[] = $to . ' 00:00:00'; }
        $filter = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $sql = "SELECT sr.ticket_no, sr.title, c.name AS category, sr.location, sr.priority, sr.status, u.full_name AS requester, $dateColumns FROM service_requests sr INNER JOIN categories c ON c.id = sr.category_id INNER JOIN users u ON u.id = sr.user_id$filter ORDER BY sr.created_at DESC";
        $query = $this->db->prepare($sql);
        $query->execute($params);
        return $query;
    }

    private function dateRange(Request $request): array
    {
        $from = trim((string) $request->query('from', ''));
        $to = trim((string) $request->query('to', ''));
        $datePattern = '/^\d{4}-\d{2}-\d{2}$/';
        if (($from !== '' && !preg_match($datePattern, $from)) || ($to !== '' && !preg_match($datePattern, $to))) Response::error('Dates must use YYYY-MM-DD format.', 422);
        if ($from !== '' && $to !== '' && $from > $to) Response::error('The start date cannot be after the end date.', 422);
        return [$from, $to];
    }

    private function dateRangeLabel(array $range): string
    {
        [$from, $to] = $range;
        if ($from && $to) return "$from to $to";
        if ($from) return "$from onward";
        if ($to) return "through $to";
        return 'All dates';
    }

    public function docs(): void
    {
        Response::json([
            'openapi' => '3.0.0',
            'info' => ['title' => 'MivaFix API', 'version' => '1.0.0', 'description' => 'University facilities maintenance request API.'],
            'servers' => [['url' => '/api']],
            'security' => [['cookieAuth' => []]],
            'paths' => [
                '/auth/register' => ['post' => ['summary' => 'Create a student/staff account']],
                '/auth/login' => ['post' => ['summary' => 'Start a session']],
                '/auth/logout' => ['post' => ['summary' => 'End a session']],
                '/auth/me' => ['get' => ['summary' => 'Read the current session']],
                '/dashboard' => ['get' => ['summary' => 'Read role-based dashboard totals']],
                '/notifications' => ['get' => ['summary' => 'List in-app notifications']],
                '/notifications/read' => ['post' => ['summary' => 'Mark notifications as read']],
                '/categories' => ['get' => ['summary' => 'List request categories']],
                '/requests' => ['get' => ['summary' => 'Search, filter and paginate visible requests'], 'post' => ['summary' => 'Create a request, optionally with image evidence']],
                '/requests/{id}' => ['get' => ['summary' => 'Read request details and audit trail'], 'patch' => ['summary' => 'Edit a request']],
                '/requests/{id}/evidence' => ['get' => ['summary' => 'View uploaded request evidence']],
                '/requests/{id}/assign' => ['post' => ['summary' => 'Assign a request to an officer']],
                '/requests/{id}/status' => ['post' => ['summary' => 'Update request status and create an audit event']],
                '/users' => ['get' => ['summary' => 'List users']],
                '/officers' => ['get' => ['summary' => 'List active maintenance officers']],
                '/export/requests.csv' => ['get' => ['summary' => 'Download request data as CSV', 'parameters' => $this->dateParameters()]],
                '/export/requests.pdf' => ['get' => ['summary' => 'Download request data as PDF', 'parameters' => $this->dateParameters()]],
            ],
            'components' => ['securitySchemes' => ['cookieAuth' => ['type' => 'apiKey', 'in' => 'cookie', 'name' => 'mivafix_session']]],
        ]);
    }

    private function dateParameters(): array
    {
        return [
            ['name' => 'from', 'in' => 'query', 'required' => false, 'schema' => ['type' => 'string', 'format' => 'date'], 'description' => 'Inclusive start date.'],
            ['name' => 'to', 'in' => 'query', 'required' => false, 'schema' => ['type' => 'string', 'format' => 'date'], 'description' => 'Inclusive end date.'],
        ];
    }
}
