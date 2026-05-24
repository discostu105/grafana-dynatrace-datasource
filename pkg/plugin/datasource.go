package plugin

import (
	"context"
	"time"

	"github.com/discostu105/dynatracegrail/pkg/dynatrace"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// Datasource holds the authenticated DQL client.
// envErr captures startup configuration errors (missing env vars) so
// CheckHealth can surface them with a clear message.
type Datasource struct {
	dt     *dynatrace.Client
	envErr error
}

func NewDatasource(_ context.Context, _ backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	c, err := dynatrace.NewFromEnv()
	return &Datasource{dt: c, envErr: err}, nil
}

func (d *Datasource) Dispose() {}

func (d *Datasource) QueryData(_ context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	resp := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		resp.Responses[q.RefID] = backend.ErrDataResponse(backend.StatusBadRequest, "QueryData not implemented yet (M3)")
	}
	return resp, nil
}

func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if d.envErr != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: d.envErr.Error()}, nil
	}
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if _, err := d.dt.ExecuteDQL(cctx, "data record(x = 1)"); err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: err.Error()}, nil
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "DQL OK"}, nil
}
