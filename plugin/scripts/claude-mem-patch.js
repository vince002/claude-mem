#!/usr/bin/env bun
/**
 * Claude-Mem API Patch
 * 修复:
 * 1. /api/observations 添加 type 过滤支持
 * 2. 添加 /api/search-local 使用 SQLite FTS 搜索
 */

import { serve } from "bun";
import { Database } from "bun:sqlite";

const WORKER_URL = "http://127.0.0.1:37777";
const DB_PATH = "/root/.claude-mem/claude-mem.db";

const db = new Database(DB_PATH);

serve({
  port: 37778,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // 代理到原始 Worker
    if (!path.startsWith("/api/observations") && !path.startsWith("/api/search-local")) {
      return fetch(WORKER_URL + path + url.search);
    }

    // 修复 /api/observations - 支持 type 过滤
    if (path === "/api/observations") {
      const project = url.searchParams.get("project");
      const type = url.searchParams.get("type");
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

      if (conditions.length > 0) {
        sql += " WHERE " + conditions.join(" AND ");
      }

      // 获取总数
      const countSql = sql.replace(/SELECT[\s\S]+FROM/, "SELECT COUNT(*) as count FROM");
      const countResult = db.query(countSql).get(...params);
      const total = countResult?.count || 0;

      sql += " ORDER BY created_at_epoch DESC LIMIT ? OFFSET ?";
      params.push(limit + 1, offset);

      const items = db.query(sql).all(...params);
      const hasMore = items.length > limit;
      if (hasMore) items.pop();

      return Response.json({ items, hasMore, offset, limit, total });
    }

    // 新增 /api/search-local - 使用 SQLite FTS 搜索
    if (path === "/api/search-local") {
      const query = url.searchParams.get("query");
      const project = url.searchParams.get("project");
      const type = url.searchParams.get("type");
      const limit = parseInt(url.searchParams.get("limit") || "20");

      if (!query) {
        return Response.json({ error: "query parameter required" }, { status: 400 });
      }

      try {
        let sql = `
          SELECT o.id, o.memory_session_id, o.project, o.type, o.title, o.subtitle, 
                 o.narrative, o.text, o.created_at, o.created_at_epoch
          FROM observations o
          JOIN observations_fts fts ON o.id = fts.rowid
          WHERE observations_fts MATCH ?
        `;
        const params = [query];

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

        const items = db.query(sql).all(...params);
        return Response.json({ items, hasMore: false, offset: 0, limit, query });
      } catch (e) {
        // FTS 失败时回退到 LIKE 搜索
        let sql = `
          SELECT id, memory_session_id, project, type, title, subtitle, 
                 narrative, text, created_at, created_at_epoch
          FROM observations
          WHERE (text LIKE ? OR title LIKE ? OR narrative LIKE ?)
        `;
        const searchTerm = `%${query}%`;
        const params = [searchTerm, searchTerm, searchTerm];

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

    return fetch(WORKER_URL + path + url.search);
  }
});

console.log("Claude-Mem Patch Server running on http://0.0.0.0:37778");
console.log("Proxying to Worker at " + WORKER_URL);
