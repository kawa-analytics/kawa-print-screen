# KAWA print charts and dashboards

Install with `npm install`.
Configuration is available in the `config.json` file.


The following parameters are available:

- `logDirectory`: Where the logs file will be inserted
- `pathToChrome`: Path to executable Chrome
- `serverUrl`: URL to the server (Optional)


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

cmd.toggle_feature(feature_name='dashboard-export', is_enabled=True);
```

Make sure to restart the KAWA server once this configuration has been set.
