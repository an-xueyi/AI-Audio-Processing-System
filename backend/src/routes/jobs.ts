import { Router } from "express";
import { pool } from "../db.js";
import { jobCreatedTopic, producer } from "../kafka/producer.js";

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

  const job = result.rows[0];

  await producer.send({
    topic: jobCreatedTopic,
    messages: [
      {
        key: job.id,
        value: JSON.stringify({
          jobId: job.id,
          inputObjectKey: job.input_object_key,
          originalFileName: job.original_file_name,
        }),
      },
    ],
  });

  res.status(201).json(job);
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
