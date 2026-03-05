#!/usr/bin/env bun
/**
 * Claude-Mem API Patch v2
 * 完全替换原始 Worker API
 * 
 * 修复:
 * 1. /api/observations 添加 type 过滤支持
 * 2. /api/search 使用 SQLite FTS 搜索（替代 Chroma）
 */

import { serve } from "bun";
import { Database } from "bun:sqlite";

const ORIGINAL_WORKER_PORT = 37778; // 原始 worker 被移到这个端口
const PATCH_PORT = 37777;
const DB_PATH = "/root/.claude-mem/claude-mem.db";

const db = new Database(DB_PATH);

console.log("Starting Claude-Mem Patch Server...");
console.log("Will proxy non-patched requests to original worker at port " + ORIGINAL_WORKER_PORT);

serve({
  port: PATCH_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 修复 /api/observations - 支持 type 过滤
    if (path === "/api/observations") {
      const project = url.searchParams.get("project");
      const type = url.searchParams.get("type");
      const search = url.searchParams.get("search");
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const offset = parseInt(url.searchParams.get("offset") || "0");

      let sql = `SELECT id, memory_session_id, project, type, title, subtitle, narrative, text, 
                        facts, concepts, files_read, files_modified, prompt_number, 
                        created_at, created_at_epoch
                 FROM observations`;
      const conditions = [];
      const params = [];

      if (project) {
        conditions.push("project = ?");
        params.push(project);
      }
      if (type) {
        conditions.push("type = ?");
        params.push(type);
      }
      if (search) {
        conditions.push("(text LIKE ? OR title LIKE ? OR narrative LIKE ?)");
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      sql += " ORDER BY created_at_epoch DESC LIMIT ? OFFSET ?";
      params.push(limit + 1, offset);

      const items = db.query(sql).all(...params);
      const hasMore = items.length > limit;
      if (hasMore) items.pop();

      return Response.json({ items, hasMore, offset, limit });
    }

    // 修复 /api/search - 使用 SQLite FTS 搜索
    if (path === "/api/search") {
      const query = url.searchParams.get("query");
      const project = url.searchParams.get("project");
      const type = url.searchParams.get("type") || url.searchParams.get("obs_type");
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const filters = url.searchParams.get("filters");

      if (!query && !filters) {
        return Response.json({ error: "Either query or filters required for search" }, { status: 400 });
      }

      try {
        let sql;
        let params = [];

        if (query) {
          sql = `
            SELECT o.id, o.memory_session_id, o.project, o.type, o.title, o.subtitle, 
                   o.narrative, o.text, o.created_at, o.created_at_epoch
            FROM observations o
            JOIN observations_fts fts ON o.id = fts.rowid
            WHERE observations_fts MATCH ?
          `;
          params.push(query);

          if (project) {
            sql += " AND o.project = ?";
            params.push(project);
          }
          if (type) {
            sql += " AND o.type = ?";
            params.push(type);
          }

          sql += " ORDER BY rank LIMIT ?";
          params.push(limit);
        } else {
          // Handle filters parameter
          sql = `
            SELECT id, memory_session_id, project, type, title, subtitle, 
                   narrative, text, created_at, created_at_epoch
            FROM observations WHERE 1=1
          `;
          if (project) {
            sql += " AND project = ?";
            params.push(project);
          }
          if (type) {
            sql += " AND type = ?";
            params.push(type);
          }
          sql += " ORDER BY created_at_epoch DESC LIMIT ?";
          params.push(limit);
        }

        const items = db.query(sql).all(...params);
        return Response.json({ items, hasMore: false, offset: 0, limit, query });
      } catch (e) {
        // FTS 失败时回退到 LIKE 搜索
        console.log("FTS error, falling back to LIKE:", e.message);
        let sql = `
          SELECT id, memory_session_id, project, type, title, subtitle, 
                 narrative, text, created_at, created_at_epoch
          FROM observations
          WHERE 1=1
        `;
        const params = [];

        if (query) {
          sql += " AND (text LIKE ? OR title LIKE ? OR narrative LIKE ?)";
          const searchTerm = `%${query}%`;
          params.push(searchTerm, searchTerm, searchTerm);
        }

        if (project) {
          sql += " AND project = ?";
          params.push(project);
        }
        if (type) {
          sql += " AND type = ?";
          params.push(type);
        }

        sql += " ORDER BY created_at_epoch DESC LIMIT ?";
        params.push(limit);

        const items = db.query(sql).all(...params);
        return Response.json({ items, hasMore: false, offset: 0, limit, query, fallback: true });
      }
    }

    // 其他请求代理到原始 worker
    try {
      const originalUrl = `http://127.0.0.1:${ORIGINAL_WORKER_PORT}${path}${url.search}`;
      return fetch(originalUrl, {
        method: req.method,
        headers: req.headers,
        body: req.body
      });
    } catch (e) {
      return Response.json({ error: "Proxy error: " + e.message }, { status: 502 });
    }
  }
});

console.log("Claude-Mem Patch Server running on http://0.0.0.0:" + PATCH_PORT);
console.log("Fixes applied:");
console.log("  - /api/observations: Added 'type' and 'search' filter support");
console.log("  - /api/search: Using SQLite FTS instead of Chroma");
