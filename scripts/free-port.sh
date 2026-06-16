#!/usr/bin/env bash
# Print one OS-assigned free TCP port on 127.0.0.1, then release it.
# Uses node (always present — Angular toolchain). The brief release→reuse window
# is acceptable at this concurrency; consumers fail loudly on AddrInUse.
exec node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
