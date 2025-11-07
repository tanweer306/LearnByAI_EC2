import { QdrantClient } from "@qdrant/js-client-rest";
import { createHash } from "crypto";

// Initialize Qdrant client
const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
const qdrantApiKey = process.env.QDRANT_API_KEY; // Optional for self-hosted

const qdrant = new QdrantClient({
  url: qdrantUrl,
  apiKey: qdrantApiKey || undefined,
});

const collectionName = process.env.QDRANT_COLLECTION_NAME || "LearnByAI";

/**
 * Get Qdrant client instance
 */
export function getQdrantClient() {
  return qdrant;
}

/**
 * Get collection name
 */
export function getCollectionName() {
  return collectionName;
}

/**
 * Ensure collection exists with proper configuration
 */
export async function ensureCollection() {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(
      (col) => col.name === collectionName
    );

    if (!exists) {
      console.log(`📦 Creating Qdrant collection: ${collectionName}`);
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: 3072, // text-embedding-3-large dimensions
          distance: "Cosine",
        },
      });
      console.log(`✅ Collection created: ${collectionName}`);
    }
  } catch (error: any) {
    console.error("❌ Error ensuring collection:", error.message || error);
    throw error;
  }
}

/**
 * Sanitize metadata to remove invalid characters
 */
function sanitizeMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      // Remove surrogate pairs and control characters
      sanitized[key] = value.replace(/[\uD800-\uDFFF]/g, '').replace(/[\x00-\x1F\x7F]/g, ' ');
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Upsert vectors to Qdrant
 * Maintains same interface as Pinecone for easy migration
 */
export async function upsertVectors(
  vectors: Array<{
    id: string;
    values: number[];
    metadata: Record<string, any>;
  }>,
  bookId?: string
) {
  let sanitizedVectors: any[] = [];
  
  try {
    console.log(`📌 Upserting ${vectors.length} vectors to Qdrant...`);
    console.log(`   Collection: ${collectionName}`);
    console.log(`   URL: ${qdrantUrl}`);
    console.log(`   First vector dimensions: ${vectors[0]?.values.length || 0}`);
    
    // Validate vector dimensions
    const invalidVectors = vectors.filter(v => v.values.length !== 3072);
    if (invalidVectors.length > 0) {
      throw new Error(
        `Invalid vector dimensions. Expected 3072, got ${invalidVectors[0].values.length}`
      );
    }

    // Ensure collection exists
    await ensureCollection();
    
    // Sanitize all metadata and convert IDs to valid UUID format
    // Qdrant requires IDs to be either unsigned integers or valid UUIDs
    // Generate deterministic UUID from original ID using SHA256 hash
    sanitizedVectors = vectors.map(v => {
      // Generate a valid UUID from the original ID using crypto hash
      // This ensures deterministic IDs (same input = same UUID)
      const hash = createHash('sha256').update(v.id).digest('hex');
      
      // Format as UUID v5: xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx
      const qdrantId = [
        hash.substring(0, 8),
        hash.substring(8, 12),
        '5' + hash.substring(13, 16), // Version 5
        ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20),
        hash.substring(20, 32),
      ].join('-');
      
      return {
        id: qdrantId,
        vector: v.values,
        payload: {
          ...sanitizeMetadata(v.metadata),
          original_id: v.id, // Store original ID for reference
        },
      };
    });
    
    // Upsert points to Qdrant
    await qdrant.upsert(collectionName, {
      wait: true,
      points: sanitizedVectors,
    });
    
    console.log(`✅ Successfully upserted ${vectors.length} vectors to Qdrant`);
  } catch (error: any) {
    console.error("❌ Error upserting vectors to Qdrant:");
    console.error("   Collection:", collectionName);
    console.error("   URL:", qdrantUrl);
    console.error("   Vector count:", vectors.length);
    console.error("   Error:", error.message || error);
    
    // Log detailed error information
    if (error.status) {
      console.error("   Status:", error.status);
    }
    if (error.data) {
      console.error("   Error data:", JSON.stringify(error.data, null, 2));
    }
    if (error.response) {
      console.error("   Response:", error.response);
    }
    
    // Log first vector for debugging
    if (sanitizedVectors.length > 0) {
      console.error("   Sample vector:", {
        id: sanitizedVectors[0].id,
        vectorLength: sanitizedVectors[0].vector.length,
        payloadKeys: Object.keys(sanitizedVectors[0].payload),
      });
    }
    
    throw error;
  }
}

/**
 * Query similar vectors from Qdrant
 * Returns results in Pinecone-compatible format for easy migration
 */
export async function querySimilarVectors(
  queryVector: number[],
  topK: number = 5,
  filter?: Record<string, any>
) {
  try {
    // Validate query vector dimensions
    if (queryVector.length !== 3072) {
      throw new Error(
        `Invalid query vector dimensions. Expected 3072, got ${queryVector.length}`
      );
    }

    // Build Qdrant filter from Pinecone-style filter
    let qdrantFilter = undefined;
    if (filter) {
      const must: any[] = [];
      
      for (const [key, value] of Object.entries(filter)) {
        must.push({
          key,
          match: { value },
        });
      }
      
      if (must.length > 0) {
        qdrantFilter = { must };
      }
    }

    const searchResult = await qdrant.search(collectionName, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
      filter: qdrantFilter,
    });

    // Convert Qdrant results to Pinecone-compatible format
    const matches = searchResult.map((result) => ({
      id: result.id.toString(),
      score: result.score,
      metadata: result.payload || {},
    }));

    return matches;
  } catch (error: any) {
    console.error("❌ Error querying Qdrant:", error.message || error);
    throw error;
  }
}

/**
 * Query vectors from Qdrant (alias for querySimilarVectors)
 * Maintains Pinecone interface compatibility
 */
export async function queryVectors(
  queryVector: number[],
  options?: {
    topK?: number;
    filter?: Record<string, any>;
  }
) {
  return querySimilarVectors(
    queryVector,
    options?.topK || 5,
    options?.filter
  );
}

/**
 * Delete vectors from Qdrant by IDs
 */
export async function deleteVectors(ids: string[]) {
  try {
    console.log(`🗑️  Deleting ${ids.length} vectors from Qdrant...`);
    
    await qdrant.delete(collectionName, {
      wait: true,
      points: ids,
    });
    
    console.log(`✅ Successfully deleted ${ids.length} vectors`);
  } catch (error: any) {
    console.error("❌ Error deleting vectors from Qdrant:", error.message || error);
    throw error;
  }
}

/**
 * Delete all vectors for a book using filter
 */
export async function deleteBookVectors(bookId: string) {
  try {
    console.log(`🗑️  Deleting all vectors for book: ${bookId}`);
    
    await qdrant.delete(collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: "book_id",
            match: { value: bookId },
          },
        ],
      },
    });
    
    console.log(`✅ Successfully deleted vectors for book: ${bookId}`);
  } catch (error: any) {
    console.error("❌ Error deleting book vectors from Qdrant:", error.message || error);
    throw error;
  }
}

/**
 * Get collection info and stats
 */
export async function getCollectionInfo() {
  try {
    const info = await qdrant.getCollection(collectionName);
    return info;
  } catch (error: any) {
    console.error("❌ Error getting collection info:", error.message || error);
    throw error;
  }
}

/**
 * Health check for Qdrant connection
 */
export async function healthCheck() {
  try {
    const collections = await qdrant.getCollections();
    const collectionExists = collections.collections.some(
      (col) => col.name === collectionName
    );
    
    if (!collectionExists) {
      return {
        status: "warning",
        message: `Collection "${collectionName}" does not exist`,
        connected: true,
      };
    }
    
    const info = await qdrant.getCollection(collectionName);
    
    return {
      status: "ok",
      message: "Qdrant is healthy",
      connected: true,
      collection: collectionName,
      pointsCount: info.points_count,
      vectorsCount: info.vectors_count,
    };
  } catch (error: any) {
    return {
      status: "error",
      message: error.message || "Failed to connect to Qdrant",
      connected: false,
    };
  }
}
