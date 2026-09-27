-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('google');

-- CreateEnum
CREATE TYPE "OAuthConnectionStatus" AS ENUM ('active', 'needs_reauth');

-- AlterTable
ALTER TABLE "CalendarSource" DROP COLUMN "oauthAccessTokenEnc",
DROP COLUMN "oauthRefreshTokenEnc",
DROP COLUMN "tokenExpiresAt",
ADD COLUMN     "externalCalendarId" TEXT,
ADD COLUMN     "oauthConnectionId" UUID;

-- CreateTable
CREATE TABLE "OAuthConnection" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "connectedByUserId" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "accessTokenEnc" BYTEA NOT NULL,
    "refreshTokenEnc" BYTEA NOT NULL,
    "tokenExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" "OAuthConnectionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OAuthConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "userId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthConnection_workspaceId_provider_providerAccountId_key" ON "OAuthConnection"("workspaceId", "provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_stateHash_key" ON "OAuthState"("stateHash");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarSource_oauthConnectionId_externalCalendarId_key" ON "CalendarSource"("oauthConnectionId", "externalCalendarId");

-- AddForeignKey
ALTER TABLE "CalendarSource" ADD CONSTRAINT "CalendarSource_oauthConnectionId_fkey" FOREIGN KEY ("oauthConnectionId") REFERENCES "OAuthConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
