-- CreateTable
CREATE TABLE "_TodoDeps" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,
    CONSTRAINT "_TodoDeps_A_fkey" FOREIGN KEY ("A") REFERENCES "Todo" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_TodoDeps_B_fkey" FOREIGN KEY ("B") REFERENCES "Todo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "_TodoDeps_AB_unique" ON "_TodoDeps"("A", "B");

-- CreateIndex
CREATE INDEX "_TodoDeps_B_index" ON "_TodoDeps"("B");
