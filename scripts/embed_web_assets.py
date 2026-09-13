Import("env")

import os
import subprocess
import sys


project_dir = env.subst("$PROJECT_DIR")
generated_dir = os.path.join(project_dir, "firmware", "generated")

os.makedirs(generated_dir, exist_ok=True)

subprocess.check_call(["npm", "run", "build"], cwd=project_dir)
subprocess.check_call(
    ["node", "scripts/embed-web-assets.mjs", "dist", generated_dir],
    cwd=project_dir,
)

env.Append(CPPPATH=[generated_dir])
