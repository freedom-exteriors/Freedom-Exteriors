-- AlterTable
ALTER TABLE "DepartureAlert" ADD COLUMN     "computedForPlaceId" UUID,
ADD COLUMN     "computedForStart" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
