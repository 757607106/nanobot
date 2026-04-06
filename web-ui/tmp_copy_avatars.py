import shutil, glob, os, re

src_dir = '/Users/pusonglin/.gemini/antigravity/brain/62989ffd-35aa-4609-a63b-414de13546ce'
dst_dir = '/Users/pusonglin/PycharmProjects/nanobot/web-ui/public/avatars'
os.makedirs(dst_dir, exist_ok=True)

for pattern in ['flat_*', 'chibi_*']:
    for f in glob.glob(os.path.join(src_dir, pattern + '.png')):
        bn = os.path.basename(f)
        clean = re.sub(r'_\d+\.png$', '.png', bn).replace('_', '-')
        dst = os.path.join(dst_dir, clean)
        shutil.copy2(f, dst)
        print(f'  copied: {clean}')

files = os.listdir(dst_dir)
print(f'\nTotal: {len(files)} files in {dst_dir}')
for f in sorted(files):
    print(f'  {f}')
