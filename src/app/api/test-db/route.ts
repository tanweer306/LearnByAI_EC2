import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });

    return NextResponse.json({ status: "ok", database: db.databaseName });
  } catch (error) {
    console.error("MongoDB health check failed:", error);

    return NextResponse.json(
      {
        status: "error",
        message: "Failed to connect to MongoDB",
        error:
          error instanceof Error
            ? error.message
            : "Unknown MongoDB connection error",
      },
      { status: 500 }
    );
  }
}
