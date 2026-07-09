import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

router.post("/", async (req, res) => {
  const { originalFileName, inputObjectKey } = req.body;
  if (!originalFileName || !inputObjectKey) {
    return res.status(400).json({
      error: "originalFileName and inputObjectKey are required",
    });
  }

  const result = await pool.query(
    `INSERT INTO jobs (original_file_name, input_object_key, status, progress) VALUES ($1, $2, $3, $4) RETURNING *`,
    [originalFileName, inputObjectKey, "PENDING", 0],
  );

  res.status(201).json(result.rows[0]);
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
});

export default router;
