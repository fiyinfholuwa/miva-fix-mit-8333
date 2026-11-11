<?php

declare(strict_types=1);

namespace MivaFix;

final class Router
{
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = [strtoupper($method), $pattern, $handler];
    }

    public function dispatch(Request $request): void
    {
        foreach ($this->routes as [$method, $pattern, $handler]) {
            if ($method !== $request->method()) continue;
            $regex = '#^' . preg_replace('#\{[^/]+\}#', '([^/]+)', trim($pattern, '/')) . '/?$#';
            if (preg_match($regex, trim($request->path(), '/'), $matches)) {
                array_shift($matches);
                $handler($request, ...array_map('urldecode', $matches));
                return;
            }
        }
        Response::error('API route not found.', 404);
    }
}
