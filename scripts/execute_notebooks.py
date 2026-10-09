"""Execute every supported notebook in a fresh kernel and save verified outputs."""
from pathlib import Path
import os
import tempfile
import nbformat
from nbclient import NotebookClient
from jupyter_client.kernelspec import KernelSpecManager

ROOT = Path(__file__).resolve().parents[1]

def main():
    # Install an ephemeral kernelspec under a writable temporary directory.
    # ipykernel's default python3 spec follows the interpreter running this script.
    with tempfile.TemporaryDirectory(prefix='nem-notebooks-') as temporary:
        runtime = Path(temporary) / 'runtime'
        runtime.mkdir()
        os.environ['JUPYTER_RUNTIME_DIR'] = str(runtime)
        os.environ['IPYTHONDIR'] = str(Path(temporary) / 'ipython')
        os.environ['MPLCONFIGDIR'] = str(Path(temporary) / 'matplotlib')
        os.environ['OMP_NUM_THREADS'] = '2'
        manager = KernelSpecManager()
        for path in sorted((ROOT / 'notebooks').glob('*.ipynb')):
            print(f'Executing {path.name}...', flush=True)
            notebook = nbformat.read(path, as_version=4)
            client = NotebookClient(notebook, timeout=600, kernel_name='python3', resources={'metadata': {'path': str(ROOT)}}, kernel_spec_manager=manager)
            client.execute()
            for cell in notebook.cells:
                for output in cell.get('outputs', []):
                    if output.output_type == 'error':
                        raise RuntimeError(f'{path.name}: {output.ename}: {output.evalue}')
            nbformat.validate(notebook)
            nbformat.write(notebook, path)
            print(f'  Saved {sum(c.cell_type == "code" for c in notebook.cells)} executed code cells.', flush=True)

if __name__ == '__main__':
    main()
