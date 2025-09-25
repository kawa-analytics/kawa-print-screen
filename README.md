# KAWA print charts and dashboards

Install with `npm install`.
Configuration is available in the `config.json` file.

In order for KAWA to connect to this script, please use the following:

```python
from kywy.client.kawa_client import KawaClient as K

kawa = K.load_client_from_environment()
cmd = kawa.commands

path_to_print_project = '/path/to/project'

cmd.replace_configuration('PrinterConfiguration', {
    'chartExportCommandLine': f'node  {path_to_print_project}/chart-export.js',
    'dashboardExportCommandLine': f'node {path_to_print_project}/print/dashboard-export.js'
})
```

Make sure to restart the KAWA server once this configuration has been set.
