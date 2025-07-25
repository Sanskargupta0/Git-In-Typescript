import crypto, { hash } from "crypto";
import * as fs from "fs";
import zlib from "zlib";

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
  Init = "init",
  CatFile = "cat-file",
  HashObject = "hash-object",
  LsTree = "ls-tree",
  WriteTree = "write-tree",
  CommitTree = "commit-tree",
  Clone = "clone",
}

const hexToBytes = (hex: string): string => {
  const bytes = new Uint8Array(20);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return String.fromCharCode(...bytes);
};

const readFileSync = (
  objectHash: string,
  toString = true,
  directory?: string
): string | Buffer => {
  const objectPath = `${
    directory ? directory + "/" : ""
  }.git/objects/${objectHash.slice(0, 2)}/${objectHash.slice(2)}`;
  const buffer = fs.readFileSync(objectPath);
  const decompressed = zlib.inflateSync(buffer as any);
  return toString ? decompressed.toString() : decompressed;
};

const hashBuffer = (
  buffer: Buffer,
  type: "blob" | "tree" | "commit" = "blob"
): { hash: string; content: any } => {
  const metaData: any = Buffer.from(`${type} ${buffer.length}\0`);

  const content: any = Buffer.concat([metaData, buffer]);
  const hash = crypto.createHash("sha1").update(content).digest("hex");
  return { hash, content };
};

const writeFileSyncToPath = (path: string, content: any): void => {
  const paths = path.split("/");
  let dir = "";
  for (let i = 0; i < paths.length - 1; i++) {
    dir += `${paths[i]}/`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
    }
  }
  fs.writeFileSync(path, content);
};

const writeFileSync = (
  hash: string,
  content: any,
  directory?: string
): void => {
  const compressed: any = zlib.deflateSync(content);
  writeFileSyncToPath(
    `${directory ? directory + "/" : ""}.git/objects/${hash.slice(
      0,
      2
    )}/${hash.slice(2)}`,
    compressed
  );
};

const recursiveReadDir = (dir: string): string => {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  const result: { mode: number; name: string; hash: string }[] = [];
  for (const file of files) {
    if (file.name === ".git") {
      continue;
    }
    if (file.isDirectory()) {
      const treeHash = recursiveReadDir(`${dir}/${file.name}`);
      result.push({
        mode: 40000,
        name: file.name,
        hash: treeHash,
      });
    } else {
      // 100644 (regular file)
      // 100755 (executable file)
      // 120000 (symbolic link)
      if (file.isSymbolicLink()) {
        continue;
      }

      let executable: boolean;
      try {
        fs.accessSync(`${dir}/${file}`, fs.constants.X_OK);
        executable = true;
      } catch {
        executable = false;
      }
      result.push({
        mode: executable ? 100755 : 100644,
        name: file.name,
        hash: hashBuffer(fs.readFileSync(`${dir}/${file.name}`)).hash,
      });
    }
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  const content = Buffer.concat(
    result.map(({ mode, name, hash }) =>
      Buffer.concat([
        Buffer.from(`${mode} ${name}\0`) as any,
        Buffer.from(hash, "hex") as any,
      ])
    ) as any[]
  );

  const { hash: treeHash, content: treeContent } = hashBuffer(content, "tree");
  writeFileSync(treeHash, treeContent);
  return treeHash;
};

switch (command) {
  case Commands.Init:
    // You can use print statements as follows for debugging, they'll be visible when running tests.
    console.error("Logs from your program will appear here!");

    // Uncomment this block to pass the first stage
    fs.mkdirSync(".git", { recursive: true });
    fs.mkdirSync(".git/objects", { recursive: true });
    fs.mkdirSync(".git/refs", { recursive: true });
    fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
    console.log("Initialized git directory");
    break;
  case Commands.CatFile: {
    const objectHash = args[2];
    const fileContent = readFileSync(objectHash) as string;

    process.stdout.write(fileContent.split("\0")[1]);
    break;
  }
  case Commands.HashObject: {
    const file = args[2];
    const fileContent = fs.readFileSync(file);
    const { hash, content } = hashBuffer(fileContent);
    process.stdout.write(hash);
    writeFileSync(hash, content);
    break;
  }
  case Commands.LsTree: {
    const treeHash = args[2];
    const treeContent = readFileSync(treeHash) as string;
    const fileNames = treeContent
      .split("\0")
      .slice(1, -1)
      .map((str) => str.split(" ")[1]);
    for (const fileName of fileNames) {
      process.stdout.write(`${fileName}\n`);
    }
    break;
  }
  case Commands.WriteTree: {
    const hash = recursiveReadDir(".");
    process.stdout.write(hash);
    break;
  }
  case Commands.CommitTree: {
    const treeHash = args[1];
    const parentHash = args[3];
    const message = args[5];

    const currentTime = Math.floor(Date.now() / 1000);
    const commitContent = Buffer.concat([
      Buffer.from(`tree ${treeHash}\n`),
      parentHash ? Buffer.from(`parent ${parentHash}\n`) : Buffer.alloc(0),
      Buffer.from(
        `author Jun Park <pj2417@gmail.com> ${currentTime} +0900\n`
      ) as any,
      Buffer.from(
        `committer Jun Park <pj2417@gmail.com> ${currentTime} +0900\n\n`
      ) as any,
      Buffer.from(`${message}\n`) as any,
    ]) as any;
    const { hash, content } = hashBuffer(commitContent, "commit");
    writeFileSync(hash, content);
    process.stdout.write(hash);
    break;
  }
  case Commands.Clone: {
    const url = args[1];
    const directory = args[2];

    const infoRefResponse = await fetch(
      url + "/info/refs?service=git-upload-pack"
    );
    const body = await infoRefResponse.text();
    const lines = body.split("0000").slice(1).join("0000").split("\n");
    const hashSet = new Set<string>();
    for (const line of lines) {
      const [content, capListStr] = line.split("\u0000");
      const size = parseInt(content.slice(0, 4), 16);
      if (size === 0) {
        break;
      }
      const hash = content.slice(4, 44);
      const ref = content.slice(45);
      const capList = (capListStr ?? "").split(" ");
      hashSet.add(hash);
      if (ref === "HEAD") {
        // HEAD save...
        const symref = capList.find((c) => c.startsWith("symref="));
        console.log(symref);
        if (symref) {
          writeFileSyncToPath(
            `${directory}/.git/HEAD`,
            Buffer.from(`ref: ${symref.slice(12)}\n`)
          );
        } else {
          writeFileSyncToPath(
            `${directory}/.git/HEAD`,
            Buffer.from(`${hash}\n`)
          );
        }
        continue;
      }
      writeFileSyncToPath(`${directory}/.git/${ref}`, Buffer.from(`${hash}\n`));
    }
    const wantHashes = hashSet.values().toArray();
    const uploadPackResponse = await fetch(url + "/git-upload-pack", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-git-upload-pack-request",
      },
      body: Buffer.concat([
        ...wantHashes.map(
          (wantHash) => Buffer.from(`0032want ${wantHash}\n`) as any
        ),
        Buffer.from("0000"),
        Buffer.from("0009done\n"),
      ]),
    });
    const uploadPackReader = uploadPackResponse.body?.getReader();
    if (!uploadPackReader) {
      throw new Error("No upload pack reader");
    }
    const uploadPackReaderLines = [];
    while (true) {
      // console.log("hihi2");
      const { done, value: line } = await uploadPackReader.read();
      // console.log(done, Buffer.from(line ?? "").toString());
      if (done) {
        break;
      }
      uploadPackReaderLines.push(line);
    }
    let packCount = 0;
    let count = 0;
    let idx = 0;
    const byteArray = Buffer.concat(uploadPackReaderLines);
    idx = byteArray.slice(0, 8).toString("utf-8") === "0008NAK\n" ? 8 : 0;
    if (byteArray.slice(idx, idx + 4).toString() === "PACK") {
      packCount =
        byteArray[idx + 8] * 256 * 256 * 256 +
        byteArray[idx + 9] * 256 * 256 +
        byteArray[idx + 10] * 256 +
        byteArray[idx + 11];
      idx += 12;
    }

    console.log("packCount", packCount);

    while (count < packCount) {
      //idx < byteArray.length
      count++;

      // MSB(1 bit) + Type(3 bits) + Size(4 bits)
      const type = (byteArray[idx] >> 4) & 7; // 1 = blob, 2 = tree, 3 = commit, 4 = tag, 6 = ofs-delta, 7 = ref-delta

      let MSB = (byteArray[idx] >> 7) & 1;
      let size = byteArray[idx] & 15;
      if (MSB === 1) {
        let move = -3;
        while (true) {
          idx++;
          move += 7;
          size = size + ((byteArray[idx] & 127) << move);
          MSB = (byteArray[idx] >> 7) & 1;
          if (MSB === 0) {
            break;
          }
        }
      }
      idx++;
      // console.log(`type: ${type}, size: ${size}`);

      let reference = "";
      let offset = 0;
      if (type === 7) {
        // ref-delta
        reference = byteArray.slice(idx, idx + 20).toString("hex");
        idx += 20;
      } else if (type === 6) {
        // ofs-delta
      }

      const { buffer: decompressedData, engine } = zlib.inflateSync(
        byteArray.slice(idx) as any,
        {
          info: true,
        }
      );
      switch (type) {
        case 1: {
          const { hash, content } = hashBuffer(
            decompressedData as any,
            "commit"
          );
          writeFileSync(hash, content, directory);
          console.log(hash);
          break;
        }
        case 2: {
          const { hash, content } = hashBuffer(decompressedData as any, "tree");
          writeFileSync(hash, content, directory);
          console.log(hash);
          break;
        }
        case 3: {
          const { hash, content } = hashBuffer(decompressedData as any, "blob");
          writeFileSync(hash, content, directory);
          console.log(hash);
          break;
        }
        case 4: {
          // OBJ_TAG not found
          break;
        }
        case 6: {
          // OBJ_OFS_DELTA not found
          break;
        }
        case 7: {
          console.log("ref:", reference);
          let dIdx = 0;
          let sourceLength = 0;
          let lIdx = 0;
          while (true) {
            sourceLength =
              sourceLength +
              (decompressedData[dIdx] & 127) * Math.pow(128, lIdx);
            if (((decompressedData[dIdx] >> 7) & 1) === 0) {
              break;
            }
            dIdx++;
            lIdx++;
          }
          dIdx++;

          let targetLength = 0;
          lIdx = 0;
          while (true) {
            targetLength =
              targetLength +
              (decompressedData[dIdx] & 127) * Math.pow(128, lIdx);
            if (((decompressedData[dIdx] >> 7) & 1) === 0) {
              break;
            }
            dIdx++;
            lIdx++;
          }
          dIdx++;
          console.log(
            `sourceLength: ${sourceLength}, targetLength: ${targetLength}`
          );

          // read file
          let readBuffer = readFileSync(reference, false, directory) as any;
          let nullIdx = 0;
          while (readBuffer.at(nullIdx) !== 0) {
            nullIdx++;
          }
          console.log(readBuffer.slice(0, nullIdx).toString());
          const objectType = readBuffer
            .slice(0, nullIdx)
            .toString()
            .split(" ")[0];
          readBuffer = readBuffer.slice(nullIdx + 1);

          let buffer = Buffer.alloc(0);

          while (dIdx < decompressedData.byteLength) {
            const byte0 = decompressedData[dIdx];
            const command = (byte0 >> 7) & 1; // 0: copy, 1: add
            console.log("command", command);
            dIdx++;
            if (command === 1) {
              let offset = 0;
              let size = 0;
              for (let i = 0; i < 7; i++) {
                const readByte = (byte0 >> i) & 1;
                if (readByte === 0) {
                  continue;
                }
                if (i < 4) {
                  offset = offset + decompressedData[dIdx] * Math.pow(256, i);
                } else {
                  size = size + decompressedData[dIdx] * Math.pow(256, i - 4);
                }
                dIdx++;
              }
              console.log(offset, size, readBuffer.length);
              buffer = Buffer.concat([
                buffer,
                Buffer.copyBytesFrom(readBuffer, offset, size),
              ] as any);
            } else {
              const size = byte0;
              console.log(size);
              const data = decompressedData.slice(dIdx, dIdx + size);
              buffer = Buffer.concat([buffer, data] as any);

              dIdx += size;
            }
          }
          const { hash, content } = hashBuffer(buffer as any, objectType);
          writeFileSync(hash, content, directory);
          console.log(objectType, hash, buffer.byteLength);

          break;
        }
      }

      idx = idx + engine.bytesRead;
      // console.log(count);
    }

    // check checksum
    // console.log(byteArray.slice(idx).toString("hex"));

    // # working directory checkout

    let HEAD = fs
      .readFileSync(`${directory}/.git/HEAD`, {
        encoding: "utf-8",
      })
      .trim();
    if (HEAD.startsWith("ref: ")) {
      HEAD = fs
        .readFileSync(`${directory}/.git/${HEAD.slice(5)}`, {
          encoding: "utf-8",
        })
        .trim();
    }
    const commit = readFileSync(HEAD, true, directory) as string;
    const queue = [
      {
        hash: commit.split("\0")[1].split("\n")[0].split(" ")[1],
        path: `${directory}/`,
      },
    ];

    while (queue.length > 0) {
      const { hash, path } = queue.shift()!;
      const objList = readFileSync(hash, false, directory) as Buffer;
      let lIdx = objList.indexOf(0) + 1;
      while (lIdx < objList.byteLength) {
        const nullIdx = objList.indexOf(0, lIdx);
        const [mode, name] = objList.slice(lIdx, nullIdx).toString().split(" ");
        const hash = objList.slice(nullIdx + 1, nullIdx + 21).toString("hex");
        lIdx = nullIdx + 21;
        if (mode === "40000") {
          // tree
          queue.push({ hash, path: `${path}${name}/` });
        } else {
          // blob
          const content = readFileSync(hash, false, directory) as Buffer;
          const nullIdx = content.indexOf(0);
          writeFileSyncToPath(`${path}${name}`, content.slice(nullIdx + 1));
          fs.chmodSync(`${path}${name}`, parseInt(mode, 8));
        }
      }
    }

    break;
  }
  default:
    throw new Error(`Unknown command ${command}`);
}