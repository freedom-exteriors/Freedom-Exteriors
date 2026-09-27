-- CreateTable
CREATE TABLE "WallDisplay" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "daysAhead" INTEGER NOT NULL DEFAULT 4,
    "showLocations" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WallDisplay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WallDisplay_tokenHash_key" ON "WallDisplay"("tokenHash");

-- CreateIndex
CREATE INDEX "WallDisplay_workspaceId_idx" ON "WallDisplay"("workspaceId");

-- AddForeignKey
ALTER TABLE "WallDisplay" ADD CONSTRAINT "WallDisplay_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
